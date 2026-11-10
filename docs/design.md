# hook-harness: GitHub events in, agent runs out

Repo: `jonathanong/hook-harness`.

## Context

hook-harness replaces auto-harness for Vouchington.

Auto-harness had two parts:

- A control plane of about 100k lines: API Gateway (REST and WebSockets), Lambda, DynamoDB, S3, EventBridge, a web UI, and assignment of work across hosts.
- A host daemon of about 20k lines.

Vouchington reached it through 7 workflows whose only job was to filter events and dispatch them. On 2026-11-05 those workflows ran about 3,150 times, and 96–100% of the runs were skipped.

hook-harness is a relay plus a CLI. GitHub events land in a short-lived store, and the agents that act on them read from it directly:

```text
GitHub App webhook -> Lambda (function URL) -> DynamoDB (1-day TTL)
                                  ^
agent (e.g. /triage-loop) -- hook-harness wait / tail / mcp / serve -- polls GET /events
```

There is no runner. The agent that consumes events decides what to do with them, owns its cursor, and runs its own work.

Decisions:

- AWS: a Lambda function URL, one DynamoDB table, and CloudFormation. Built-in TTL was the deciding factor.
- Store-and-poll; the relay holds no long-lived connections. Each request is a short Lambda → DynamoDB call. A local `serve` daemon can fan one poller out to many clients over SSE.
- 1-day retention.
- Store everything the GitHub App sends. The App's event subscriptions are the only filter, and consumers filter the rest.

## Relay (Lambda)

**`POST /webhook`**

- Verifies the HMAC over the raw bytes (base64 bodies are decoded first) with `timingSafeEqual`.
- Normalizes the event, with a generic fallback for event types that have no dedicated normalizer.
- Writes it with `PutItem` and `expiresAt = now + 1 day`.
- A manual redelivery gets a new sort key and is replayed on purpose.

**`GET /events?owner=&repos=&after=&limit=&payload=`**

- Requires a bearer token. The table stores its SHA-256 hash, repo scope, expiry and a revoked flag.
- The key condition is `SK > max(after − 60s, now − 1 day)`. The client dedupes by delivery ID.
- `after` is either the previous cursor or a bare epoch-ms start time.
- Returns `{events, cursor, gap}`. `gap` is true when `after` is older than the retention window.

**Table**

- Event items: `PK=owner#<owner>`, `SK=<receivedAt ms>#<delivery id>`.
- Token items: `PK=token#<sha256>`, `SK=token`.
- Billing is provisioned 25/25 by default (always free) or on-demand by parameter. Org-wide installs with payloads should use on-demand.

**Logs:** 1-day retention, system log level `WARN`. Payloads are never logged.

**Limits**

- Requests are capped at 6 MB. GitHub allows 25 MB and doesn't retry a 413.
- Responses are capped at 6 MB, so a page stops filling at 5 MB.
- GitHub never retries failed deliveries on its own.

**GitHub App:** read-only permissions and no private key; the relay never calls the GitHub API. Setup is in [github-app.md](github-app.md).

### Tokens

`hook-harness token create|list|revoke` writes token items directly with the caller's AWS credentials. The relay has no endpoint for minting tokens, and its role can only `GetItem`/`PutItem`/`Query`. Tokens are read-only, prefixed `hh_`, and scoped to `owner/name`, `owner/*` or `*`.

### Envelope

Each event has a small envelope for filtering, plus the webhook payload:

```jsonc
{
  "v": 1,
  "id": "<delivery>",
  "receivedAt": "...",
  "event": "pull_request",
  "action": "dequeued",
  "owner": "owner",
  "repo": "owner/name", // null for owner-level events
  "prs": [42],
  "issue": null,
  "headSha": "...",
  "headRef": "...",
  "baseRef": "main",
  "reason": "CI_FAILURE",
  "conclusion": null,
  "workflow": null,
  "workflowId": null,
  "runId": null,
  "command": null, // lowercased first token of a comment/review body if it looks like /plan
  "commentId": null,
  "sender": { "login": "...", "type": "User" }, // who triggered the delivery
  "author": { "login": "...", "type": "User" }, // issue/comment/review author; can differ from sender
  "authorAssociation": "MEMBER",
  "url": "...",
  "payload": {}, // webhook body minus dropped keys; untrusted text
}
```

**Which events are stored:** every event and action the GitHub App subscribes to.

- Events with dedicated normalizers get extra envelope fields: `pull_request`, review events, `issue_comment`, `issues`, `commit_comment`, `check_suite`, `workflow_run`, `status`, `merge_group`, and `push` on any ref.
- Any other event gets `event`, `action`, `owner`, `repo` and `sender`, and the details stay in `payload`.
- Events are partitioned by `owner`: the repo owner, else the organization, else the installation account.
- Owner-level events (no repository):
  - have `repo: null`;
  - are readable only with `owner/*` or `*` tokens;
  - are excluded by `--repo`.
- Events with no owner at all, such as `security_advisory`, are dropped.

**Comments:** every comment is stored.

- `command` comes from the first token if it matches `^/[a-z0-9][a-z0-9_-]*$`. It's null otherwise and for deleted comments.
- Consumers filter on it (`/plan`, `/fix`, `/shepherd`, …).
- For provenance, `authorAssociation` is the author's relationship to the repo, and `author` is the comment author.
- GitHub reports org members with private membership as `CONTRIBUTOR` or `NONE` in webhooks. Verify membership through the API before trusting it for privileged actions.

**Payloads**

- Stored gzipped next to the envelope, minus `installation` (always) and the keys in `PayloadDrop` (default `repository,organization`).
- Payloads over `PayloadMaxBytes` (default 1 MB of JSON) or over 350 KB gzipped are left out with `payloadOmitted: "too_large"`.
- `GET /events?payload=0` skips them (`payloadOmitted: "not_requested"`).
- Payload text, and attacker-influenced envelope strings (`headRef`, `workflow`, `sender.login`), are untrusted input.

## CLI

`packages/cli` publishes the `hook-harness` npm package.

**Operations** (need AWS credentials):

- `deploy`, `update`, `teardown --yes`, `status`;
- `token create|list|revoke`.

Deployment state lives in `~/.config/hook-harness/deployments/<stack>.json`.

**Consumers** (need a reader token from `login` or `token create --login`):

- `wait` blocks until a match and prints one JSON object, `{events, gap, cursor, timedOut?}`. It exits 0 for a match, a gap or a timeout, and 1 for an auth failure or the relay unreachable.
- `tail` streams NDJSON.
- Filters:
  - Flags form one filter, and each repeatable `--filter '<EventFilter JSON>'` is another. Filters are OR'd.
  - A filter can match on `event`, `action`, `repo`, `branch`, `command`, `reason`, `conclusion`, `pr`, `minAssociation` and `ignoreSenders`.
- Cursors:
  - `--after <cursor>` is stateless and caller-owned.
  - `--cursor <name>` uses a local state file.
  - `--since <time|duration>` sets a start time.
- `serve`: a local SSE daemon. One poller fans out to many local clients, with per-client filters and `Last-Event-ID` replay.
- `mcp`: a stdio MCP server with `wait_for_events` and `get_events` tools. The caller owns the cursor.

**Plugin:** Claude Code and Codex plugins bundle the MCP server and a skill on consuming events.

## Consumers

The first consumer is Vouchington's `/triage-loop` session. It:

- runs `hook-harness wait` in the background, filtering on merge-queue ejections, failed `main` workflow runs and `/shepherd` comments;
- owns its cursor and delivery-ID dedupe;
- sweeps the GitHub API on `gap: true` and on its own 6-hour cycle;
- runs scheduled prompts and dispatches subagents itself;
- checks author trust for comment-driven work.

## Layout

pnpm workspace, TypeScript, Node 24 LTS (`nodejs24.x`, `@types/node@24`). Source runs with Node's native type stripping.

- `packages/protocol`: envelope, filters and matching.
- `packages/relay`: Lambda handler, normalizers, auth, payload packing, and `template.yaml`. It's bundled with esbuild.
- `packages/cli`: the `hook-harness` CLI (operations, `wait`/`tail`, `serve`, `mcp`).

Repo setup:

- MIT license; 100% coverage with Codecov.
- Dependabot: grouped updates, a 1-week cooldown, automerge.
- labeler and actionlint.
- oxlint (200 lines per file) and oxfmt.
- CI runs on `ubuntu-slim`; dependencies are kept at their latest versions.

## Risks

| Risk                                   | Mitigation                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Consumer down                          | Events wait up to a day; `gap: true` tells the consumer to sweep the GitHub API                 |
| Missed webhook / 413                   | Best-effort; visible in the App delivery log; consumer sweeps cover ejections and main failures |
| Comment-command abuse on a public repo | Consumers check `authorAssociation`/`author` (private org members appear as CONTRIBUTOR/NONE)   |
| Prompt injection via event strings     | Payload text is untrusted; `--no-payload`; external-data labelling                              |
| Token leak                             | Read-only, scoped, expiring tokens; `token revoke` takes effect on the next poll                |
| Volume and cost                        | The App subscription list is the volume control; on-demand billing                              |
