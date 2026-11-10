# hook-harness

GitHub events in, agent runs out.

A GitHub App sends webhooks to a small AWS Lambda, which stores a short summary of each event in DynamoDB for one day. A runner on your machine polls those events and, when a rule matches, renders a prompt and starts Claude Code, Codex, or any other CLI in a git worktree.

- **No control plane.** One Lambda function URL and one DynamoDB table with TTL. Typical cost: cents per month.
- **No always-on connection.** The runner polls; a session that starts late catches up on the last day of events.
- **Signals only.** Stored events carry IDs, refs, and outcomes, never titles, bodies, comments, or logs.

Status: under construction. See [docs/](docs/) for the design.

## Layout

| Package             | What it is                                                                   |
| ------------------- | ---------------------------------------------------------------------------- |
| `packages/protocol` | Event envelope types and filter matching                                     |
| `packages/relay`    | Lambda handler, normalizers, CloudFormation template                         |
| `packages/cli`      | `hook-harness` CLI: deploy, update, teardown, tokens, and the runner service |

## License

MIT
