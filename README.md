# hook-harness

GitHub events in, agent runs out.

A GitHub App sends webhooks to a small AWS Lambda, which stores a short summary of each event in DynamoDB for one day. A runner on your machine polls those events and, when a rule matches, renders a prompt and starts Claude Code, Codex, or any other CLI in a git worktree.

- **No control plane.** One Lambda function URL and one DynamoDB table with TTL. Typical cost: cents per month.
- **No always-on connection.** The runner polls; a session that starts late catches up on the last day of events.
- **Envelope plus payload.** Each event has a small envelope (IDs, refs, outcomes) for filtering and the webhook payload, minus `installation` and, by default, `repository` and `organization`. Configure with `PayloadDrop` / `PayloadMaxBytes`; pollers can skip payloads with `payload=0`. Payload text is untrusted input.
- **All comments are stored.** Every issue, PR, review and review comment event is kept (comments: created, edited, deleted); there is no command allowlist. `command` is the lowercased first token of the body when it looks like `/plan` (else null), so agents filter with `--command /plan`. `authorAssociation` (OWNER, MEMBER, COLLABORATOR, ...) and `author` (the comment author, who can differ from `sender` on edits and deletes) give provenance. GitHub reports organization members with private membership as `CONTRIBUTOR` or `NONE` in webhooks, so use `--min-association` carefully or verify membership via the API.

Status: under construction. See [docs/](docs/) for the design.

## Install

```sh
npx hook-harness deploy          # run any command without installing
pnpm add -g hook-harness         # or install globally, then: hook-harness <command>
```

Requires Node 24+. The package bundles the relay Lambda code and CloudFormation template that `deploy` and `update` use. Publishing is described in [docs/publishing.md](docs/publishing.md).

## Layout

| Package             | What it is                                                                   |
| ------------------- | ---------------------------------------------------------------------------- |
| `packages/protocol` | Event envelope types and filter matching                                     |
| `packages/relay`    | Lambda handler, normalizers, CloudFormation template                         |
| `packages/cli`      | `hook-harness` CLI: deploy, update, teardown, tokens, and the runner service |

## License

MIT
