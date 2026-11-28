# hook-harness: Pull-based GitHub webhook relay for coding agents

Repo: `jongleberry/hook-harness`.

## Context

hook-harness is a relay plus a CLI. GitHub events land in a short-lived store, and the agents that act on them read from it directly:

```text
GitHub App webhook -> Lambda (function URL) -> DynamoDB (1-day TTL)
                                  ^
agent -- hook-harness wait / tail / mcp / serve -- polls GET /events
```

There is no runner. The agent that consumes events decides what to do with them, owns its cursor, and runs its own work.

Decisions:

- AWS: a Lambda function URL, one DynamoDB table, and CloudFormation. Built-in TTL was the deciding factor.
- Store-and-poll; the relay holds no long-lived connections. Each request is a short Lambda → DynamoDB call. A local `serve` daemon can fan one poller out to many clients over SSE.
- 1-day retention.
- Store everything the GitHub App sends. The App's event subscriptions are the only filter, and consumers filter the rest.

### Why pull instead of push

Webhooks push into DynamoDB and agents pull from it, rather than pushing webhooks straight to agents:

- **Batching and turn cost.** Delivering every webhook immediately would trigger an agent turn per event, many of them irrelevant or part of a burst. Consumers have to filter and batch events anyway (`wait` and `wait_for_events` settle a burst before returning).
- **Cursor-based resume.** Because events remain in DynamoDB for a day and each consumer tracks its own cursor, an agent that disconnects or hits a usage limit can pick up where it left off (and receives `gap: true` if its cursor falls past retention).
- **Resilient to CLI and agent disconnects.** Neither the CLI nor the agent needs a reachable callback endpoint or an always-on connection, so disconnects, restarts, and machine sleeps do not drop webhooks.

## Relay (Lambda)

**`POST /webhook`**

- Verifies the HMAC over the raw bytes (base64 bodies are decoded first) with `timingSafeEqual`.
- Normalizes the event, with a generic fallback for event types that have no dedicated normalizer.
- Writes it with `PutItem` and `expiresAt = now + 1 day`.
- A manual redelivery gets a new sort key and is replayed on purpose.

**`GET /events?owner=&repos=&after=&limit=&payload=&filters=`**

- Requires a bearer token. The table stores its SHA-256 hash, repo scope, expiry and a revoked flag.
- The key condition is `SK > max(after − 60s, now − 1 day)`. The client dedupes by delivery ID.
- `after` is either the previous cursor or a bare epoch-ms start time.
- A valid token whose repo scope covers nothing under `owner` gets 403 `{error, owner, scopes}`; a missing, revoked or expired token gets 401.
- Returns `{events, cursor, gap, more}`. `gap` is true when `after` is older than the retention window. `more` is true when the page was cut short (limit, 5 MB budget or scan cap), so poll again right away.
- `filters` is a URL-encoded JSON array of EventFilter objects (at most 50), OR'd. The relay drops non-matching events before unpacking payloads, which shrinks responses. It doesn't reduce DynamoDB reads, because the partition is per owner. Unknown fields are ignored, so an older relay returns more than asked. Clients still filter locally, which means filter fields are append-only with frozen semantics.
- At most 1000 items are read per request, whether they match or not, so a filter that matches little can't read the whole day at once. Hitting that cap returns `<last scanned>!` as the cursor, which resumes without replaying the overlap.
- `wait`, `tail` and MCP send their filters. `serve` doesn't, because it polls once for clients with different filters.

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

## Local fan-out (`serve`)

The relay stays store-and-poll. On one machine, `hook-harness serve` is the only thing that polls it: it keeps a bounded in-memory ring buffer (1000 events or 1 hour) and streams events to local clients over SSE with per-client filters, `Last-Event-ID` (or `?after=`) replay, `: ping` keepalives every 15s, and an explicit `gap` event (`{"cursor":"..."}`). `wait`/`tail --source <url>` are a second `EventSource` implementation over that stream, so filtering, settle and cursors are unchanged.

- `GET /events` streams `id: <cursor>`, `event: envelope`, `data: <envelope JSON>` with query-param filtering (`event action repo branch command reason conclusion workflow sender label reviewer sha ref on pr minAssociation ignoreSender`, plus repeatable `filter=<EventFilter JSON>`, OR'd).
- `GET /healthz` returns `{ok, upstream: {lastPollAt, lastError, cursor}, clients, buffered}`. Relay errors back off like `tail`; `SIGINT`/`SIGTERM` close streams and save the cursor.
- Trust model: binds to loopback only and refuses another `--host` unless `--allow-remote` and `--auth-token` are given (`Authorization: Bearer`; `HOOK_HARNESS_SERVE_TOKEN` and `HOOK_HARNESS_SOURCE_TOKEN` keep tokens off command lines). With `--allow-remote`, `serve` speaks plain HTTP, so route remote access through a TLS proxy or an encrypted tunnel. Without a token, any local process can read events (`--no-payload` drops payloads), and requests with an `Origin` header or non-loopback `Host` header are rejected to block browsers and DNS rebinding.
- Cursors: the SSE `id` is an encoded cursor (relay sort key plus delivery id), so single-owner cursors printed by `wait`/`tail` are interchangeable between relay and `serve` sources. A multi-owner cursor is not: a `serve` stream has one position, so `--source` refuses it (saved or via `--after`); give `serve` and its clients different `--cursor` names.

## CLI

`packages/cli` publishes the `hook-harness` npm package.

**Operations** (need AWS credentials):

- `deploy`, `update` (`--alarm-email` / `--alarm-quiet-hours` configure CloudWatch alarms for 5xx responses, throttles, and quiet periods; `--alarm-email ""` removes them), `teardown --yes`, `status`;
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
  - `--owner a,b` polls each owner's partition separately and keeps one position per owner in a single cursor (`v: 2`). A single-owner cursor (`v: 1`) applies to every owner; an owner the cursor lacks starts from `--since`, else now. With one owner the cursor stays `v: 1`.
- `serve`: a local SSE daemon. One poller fans out to many local clients, with per-client filters and `Last-Event-ID` replay.
- `mcp`: a stdio MCP server with `wait_for_events`, `get_events` and `filter_help` tools. Stateless by default (caller passes `cursor` back as `after`); optional `cursor_name` opts in to the local cursor file. Long waits send MCP progress notifications when the client provides a progress token; keep `timeout_seconds` under client tool-call caps (e.g. `MCP_TOOL_TIMEOUT`). Local checkout dev: `node /path/to/packages/cli/src/bin.ts mcp`.

**Plugin:** Claude Code and Codex plugins bundle the MCP server and a skill on consuming events.

## Consumers

A typical autonomous consumer (for example, a triage or PR-shepherd session):

- runs `hook-harness wait` (or MCP `wait_for_events`) in the background, filtering on merge-queue ejections, failed `main` workflow runs, and slash-command comments;
- owns its cursor and delivery-ID dedupe;
- sweeps the GitHub API on `gap: true` and on a periodic fallback cadence;
- runs scheduled prompts and dispatches subagents itself;
- checks author trust for comment-driven work.

## Layout

pnpm workspace, TypeScript, Node 24 LTS (`nodejs24.x`, `@types/node@24`). Source runs with Node's native type stripping.

- `packages/protocol`: envelope, filters and matching.
- `packages/relay`: Lambda handler, normalizers, auth, payload packing, and `template.yaml`. It's bundled with esbuild.
- `packages/cli`: the `hook-harness` CLI (operations, `wait`/`tail`, `serve`, `mcp`).

Repo setup:

- MIT license; 100% coverage with Codecov.
- Dependabot: grouped updates and a 1-week cooldown. Auto-merge is off in this repo; green Dependabot PRs are merged by hand.
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
| Volume and cost                        | The App subscription list is the volume control; on-demand billing (see [costs.md](costs.md))   |
