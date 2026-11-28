# hook-harness

Pull-based GitHub webhook relay for coding agents. Part of [ratchet-stack](https://github.com/jongleberry/ratchet-stack).

A GitHub App pushes webhooks to a small AWS Lambda + DynamoDB table (1-day TTL), and agents pull matching events through the CLI (`wait`, `tail`, `serve`) or the MCP server (`wait_for_events`, `get_events`) using a cursor they own.

```text
GitHub App webhook -> Lambda -> DynamoDB (1-day TTL) <- agent (wait / tail / mcp / serve)
```

## Design

Webhooks push to DynamoDB and agents pull from it instead of a true webhook push model:

- **Batching and turn efficiency.** Delivering every webhook straight to an agent would trigger a turn per event, many irrelevant or part of a burst. Agents have to filter and batch anyway (`wait` and `wait_for_events` let a burst settle before returning).
- **Resuming after disconnects or usage limits.** Events stay buffered in DynamoDB for one day and each consumer owns its cursor, so an agent that disconnects, restarts, or hits a usage limit picks up where it left off (or gets `gap: true` past retention).
- **Tolerates CLI and agent disconnects.** Pull needs no always-on connection or public callback endpoint, so network drops, sleeps, and process restarts do not lose events.
- **No control plane.** One Lambda function URL and one DynamoDB table with TTL — **$0/month** on AWS Always Free tiers, or **~$0.12–$4.80/month** on DynamoDB On-Demand ([cost model](docs/costs.md)). Stores a filterable envelope plus optional payload for every subscribed event and comment, with no command allowlist. Payload text is untrusted input.

See [docs/design.md](docs/design.md) for the full architecture, envelope schema, and trust model.

## CLI and common triggers

`hook-harness wait` blocks until matching events arrive (and settle), prints one JSON object (`{events, gap, cursor, timedOut?}`), and exits 0. `hook-harness tail` streams matches as NDJSON.

`--on` adds named filter presets (repeatable or comma lists; OR'd with other filters). The MCP tools take the same names as `on`.

| Preset                                               | Matches                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ejection`                                           | Merge-queue ejection (`pull_request` `dequeued` with a failure reason, not `MERGE`) |
| `main-failure`                                       | Failed `workflow_run`, or another App's `check_suite` (not Actions'), on `main`     |
| `dependabot-pr`                                      | Dependabot opened or reopened a PR                                                  |
| `review-requested`, `review-requested:<login\|team>` | A review was requested (from that reviewer)                                         |
| `label:<name>`                                       | That label was added to an issue or PR                                              |
| `/<command>`                                         | A new comment starting with that command, e.g. `/shepherd`                          |

```sh
hook-harness wait --owner acme --on ejection,main-failure,dependabot-pr,/shepherd --on label:needs-review --no-payload
```

- **Custom filters:** combine field flags (`--event`, `--action`, `--branch`, `--command`, `--label`, `--pr`, `--min-association`, etc.) or pass repeatable `--filter '<json>'` objects. Run `hook-harness wait --help` for all flags.
- **Multiple owners:** `--owner acme,acme-labs` polls each owner under one cursor (the token's repo scope must cover every owner).
- **Provenance:** `authorAssociation` and `author` come from the webhook. Private org members appear as `CONTRIBUTOR` or `NONE`, so verify membership via the GitHub API before privileged actions (see [docs/github-app.md](docs/github-app.md#notes-for-agents)).

## Sharing one poller: `hook-harness serve`

Several agents on one machine can share a single relay poller. `serve` polls the relay once and fans events out over Server-Sent Events; `wait` and `tail` read from it with `--source` (or `HOOK_HARNESS_SOURCE`).

```sh
hook-harness serve --owner acme,acme-labs --cursor relay # 127.0.0.1:7391
hook-harness wait --source http://127.0.0.1:7391 --cursor plan --event pull_request --command /plan
curl -N 'http://127.0.0.1:7391/events?event=push&branch=main'
```

- `GET /events` streams per-client filtered envelopes with `Last-Event-ID` (or `?after=`) replay from a 1000-event / 1-hour ring buffer and an explicit `gap` event if a client falls behind.
- `GET /healthz` reports `{ok, upstream: {lastPollAt, lastError, cursor}, clients, buffered}`.
- Loopback only by default; non-loopback requires `--allow-remote` and `--auth-token` (`Authorization: Bearer`). Details in [docs/design.md](docs/design.md#local-fan-out-serve).

## MCP server

`hook-harness mcp` runs a stdio MCP server so agents consume events as tools. Log in first with `hook-harness login` (or set `HOOK_HARNESS_URL` and `HOOK_HARNESS_TOKEN`).

```sh
# Claude Code
claude mcp add hook-harness -- npx -y hook-harness mcp
```

```toml
# Codex (~/.codex/config.toml)
[mcp_servers.hook-harness]
command = "npx"
args = ["-y", "hook-harness", "mcp"]
```

| Tool              | What it does                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `wait_for_events` | Blocks like `wait` (`timeout_seconds` default 240, max 600; `settle_seconds` default 5) and returns a JSON batch. |
| `get_events`      | One non-blocking poll; returns `{events, gap, cursor}`.                                                           |
| `filter_help`     | Returns `EventFilter` fields and examples.                                                                        |

The server is stateless: pass the returned `cursor` back as `after` (or pass `cursor_name` to use a local cursor file). `owner` accepts a comma list; `gap: true` means sweep the GitHub API to catch up. Keep `timeout_seconds` under your client's tool-call cap (e.g. `MCP_TOOL_TIMEOUT` in Claude Code).

## Client API: `hook-harness/client`

To read events in-process instead of starting the CLI, add `hook-harness` as a dependency and import `hook-harness/client` (ESM, Node 24+; its types need `@types/node`). This export is a stable contract: a breaking change to it ships as a major version.

```ts
import { pollEvents, resolveClient } from "hook-harness/client";

const client = await resolveClient(); // saved `hook-harness login`, or HOOK_HARNESS_URL / HOOK_HARNESS_TOKEN
for await (const batch of pollEvents({ ...client, owner: "acme", on: ["ejection"], signal })) {
  if ("error" in batch) continue; // transient: already retried with backoff
  handle(batch.events);
  save(batch.cursor); // pass back as `after` to resume
}
```

| Export                     | What it does                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveClient(env?)`      | Returns `{url, token}` from `client.json` (`hook-harness login`), with `HOOK_HARNESS_URL` / `HOOK_HARNESS_TOKEN` overriding each field. Throws `NotLoggedInError` when either is missing.                                                                                                                                                                                 |
| `fetchEventsPage(options)` | One `GET /events` request; returns the `EventsPage` (`events`, `cursor`, `more`, `gap`) as the relay sent it. Pages repeat events from the 60 seconds before `after`, and filters past 50 entries or 4000 characters are not sent, so filter and dedupe yourself or use `pollEvents`. `after` wins over `since`; with neither, reads from the start of the 24h retention. |
| `pollEvents(options)`      | Long-polls until `signal` aborts. Yields `{events, cursor, gap}` once per poll (empty or not): each event once, only events matching `filters`/`on`. `cursor` uses the same format as `hook-harness wait`'s, so either can resume the other. Starts at `after`, else `since`, else now.                                                                                   |
| `pollPages(options)`       | The raw page loop under `pollEvents`: yields `{page}` per poll, follows a cut-short page at once.                                                                                                                                                                                                                                                                         |

Options: `url`, `token`, `owner` (one per call), and optionally `repos`, `filters` (`EventFilter[]`), `on` (preset names as `--on` takes them), `payload` (default true), `after`, `since` (`Date`), `limit`, `signal`, `fetch`, and for the pollers `intervalMs` (default 5000) and `delay`. An unknown preset throws `TypeError`.

HTTP errors carry `status`:

- `UnauthorizedError` (401) and `OutOfScopeError` (403, with `owner` and the token's `scopes` when the relay names them) extend `AuthError`. Retrying cannot help, so the pollers throw them.
- `RelayError` is any other HTTP status. It and network errors (`TypeError`) are transient: the pollers yield `{error}` and retry with exponential backoff capped at 5 minutes. A 400 means a bad `after` or filter and will not clear on its own.

`Envelope`, `EventFilter` and `EventsPage` are exported as types.

## Install

Requires Node 24+.

### Agent plugin (recommended for Claude Code / Codex)

Installs the MCP server and the `hook-harness` skill from [`jongleberry/ratchet-stack`](https://github.com/jongleberry/ratchet-stack):

```bash
# Claude Code
claude plugin marketplace add jongleberry/ratchet-stack
claude plugin install hook-harness@ratchet-stack

# Codex
codex plugin marketplace add jongleberry/ratchet-stack --ref main
codex plugin add hook-harness@ratchet-stack
```

### CLI and relay

```sh
npx hook-harness deploy          # run any command without installing
pnpm add -g hook-harness         # or install globally, then: hook-harness <command>
```

1. Deploy the relay with `hook-harness deploy` (add CloudWatch alarms with `hook-harness update --alarm-email you@example.com`).
2. Create and install the GitHub App, then mint a scoped reader token (`hook-harness token create --repos '<org>/*' --login`) — see [docs/github-app.md](docs/github-app.md).

## Cost

**$0/month** on AWS Always Free tiers (default `PROVISIONED` 25/25 table), or **~$0.12–$4.80/month** on DynamoDB On-Demand (`PAY_PER_REQUEST`) from a personal repo up to a 20,000-webhook/day org. See [docs/costs.md](docs/costs.md) for the breakdown, On-Demand vs. Provisioned trade-offs, and knobs to cut spend.

## Docs

- [docs/design.md](docs/design.md) — architecture, relay endpoints, envelope, `serve`, CLI, and package layout
- [docs/costs.md](docs/costs.md) — AWS cost model, workload estimates, and tuning knobs
- [docs/github-app.md](docs/github-app.md) — GitHub App setup, permissions, tokens, and trust notes
- [docs/publishing.md](docs/publishing.md) — releasing `hook-harness` to npm

## License

MIT
