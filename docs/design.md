# hook-harness: GitHub events in, agent runs out

Repo: `jonathanong/hook-harness`.

## Context

Replaces auto-harness for Vouchington. Auto-harness is a ~100k-line serverless control plane (API Gateway REST + WS, Lambda, DynamoDB, S3, EventBridge, web UI, multi-host assignment) plus a ~20k-line host daemon. Vouchington reaches it through 7 workflows whose only job is to filter events and dispatch; on 2026-11-05 they ran ~3,150 times and 96–100% were skipped.

hook-harness:

```text
GitHub App webhook -> Lambda (function URL) -> DynamoDB (1-day TTL)
                                  ^
local runner (one host) -- polls GET /events --> matches rules -> renders prompt -> runs CLI in a worktree
```

Decisions (user-confirmed unless marked):

- AWS: Lambda function URL + one DynamoDB table + CloudFormation. Built-in TTL was the deciding factor.
- Store-and-poll, no SSE/WebSockets. Each request is a short Lambda → DynamoDB call.
- 1-day retention.
- Replaces auto-harness, reusing its host-side code.
- Assumed (recommended, not yet confirmed): single host; no web UI or Slack (local logs + session-link comment); auto-harness retired after migration.

## Relay (Lambda)

- `POST /webhook`: HMAC over raw bytes (decode base64 bodies; `timingSafeEqual`), static allowlist, normalize, `PutItem` with `expiresAt = now + 1 day`.
- `GET /events?repo=&after=`: bearer token (SHA-256 hash in table, repo scope, expiry, revoked). Key condition `SK > max(after − 60s, now − 1 day)`; client dedupes by delivery ID.
- Table: events `PK=repo#owner/name`, `SK=<receivedAt ms>#<delivery id>`; tokens `PK=token#<hash>`. Provisioned 25/25 default (always-free), on-demand by parameter.
- Logs: 1-day retention, system log level `WARN`.
- Limits: 6 MB request cap (GitHub allows 25 MB, no retry on 413); GitHub doesn't retry failures.
- App permissions read-only; private key discarded by the relay. The runner may hold its own App credentials (reuse `github-app.ts`) for session tokens.

### Envelope

A small envelope for filtering, plus the webhook payload:

```jsonc
{
  "v": 1,
  "id": "<delivery>",
  "receivedAt": "...",
  "event": "pull_request",
  "action": "dequeued",
  "repo": "owner/name",
  "prs": [42],
  "issue": null,
  "headSha": "...",
  "headRef": "...",
  "baseRef": "main",
  "reason": "CI_FAILURE",
  "conclusion": null,
  "workflow": null,
  "workflowId": null,
  "command": null, // first token of an issue/PR comment if it is an allowlisted command
  "commentId": null,
  "sender": { "login": "...", "type": "User" },
  "authorAssociation": "MEMBER",
  "url": "...",
}
```

The payload is stored gzipped alongside the envelope, minus `installation` (always) and the keys in `PayloadDrop` (default `repository,organization`). Payloads over `PayloadMaxBytes` (default 1 MB of JSON) or 350 KB gzipped are left out with `payloadOmitted: "too_large"`. `GET /events?payload=0` skips them, and a page stops filling at 5 MB to stay under the 6 MB response cap. Attacker-influenced strings (`headRef`, `workflow`, `sender.login`) are labelled as external data in prompts.

Stored events: `pull_request` (lifecycle incl. `enqueued`/`dequeued`), review events, `issue_comment` (only when it carries an allowlisted command), `check_suite.completed`, `workflow_run.completed`, `status`, `merge_group`, default-branch `push`.

## Runner (local, one host)

- Poll loop (default 15s) per configured repo; cursor + dedupe in local SQLite.
- Rules file (YAML): match on envelope fields → `template`, `vars`, `command` (catalog entry), `concurrencyKey` (template string), `priority`, `queueTtl`, `timeout`, `authorAssociation` minimum for comment commands.
- Concurrency: one live session per `concurrencyKey`; a matching event while queued or running joins it (same semantics as today's `concurrency-id`).
- Schedules: cron entries in the same rules file, run locally.
- Usage limits: per-account cooldown table in SQLite; retry on the next account's execution profile.
- Gap: cursor older than 1 day → fire the rule's `onGap` (e.g. ejection prompt's 24-hour discovery).
- Output: local log files per session; optional comment on the triggering PR/issue with status.
- Runs as a launchd/systemd service (reuse auto-harness host-service installers if they lift cleanly).

### Reused from auto-harness

Lift nearly as-is: `executor.ts`, `pty-runner.ts`, kill/timeout helpers, `secret-redacting-runner.ts`, `child-env.ts`, `resolve-executable.ts`, `github-app.ts`, git helpers (`git-commands`, `git-ref-resolution`, `git.ts` minus inventory hooks, `git-worktree-*`, `git-main-checkout-status`), `usage-adapter*.ts`, `usage-limit.ts` (drop the `providerAccountId` gate), `resume-ref-capture.ts`, `command-resume.ts`, the `Command` shape, `render-harness-prompt.mts`, `execution-profiles.ts`, `setup-script.ts`, `terminal-hook.ts`.

Rewrite: `worktree-manager.ts` (static config, keep claim + main lock), session run/orchestration (local logs instead of control-plane reporting), a small poll loop instead of `daemon-loop.ts`, new queue/concurrency/cooldown module (~100–300 lines).

Not carried over: web UI, API, WebSockets, multi-host assignment, S3 logs, Slack, users/API keys, self-updater.

## Layout

pnpm workspace, TypeScript, Node 24 LTS (`nodejs24.x`, `@types/node@24`).

- `packages/protocol`: envelope, filters, rule matching.
- `packages/relay`: Lambda handler, normalizers, auth, store, `template.yaml`.
- `packages/runner`: poll loop, rules, queue, worktrees, process runners (lifted), CLI (`deploy`, `token`, `run`, `tail`, `wait`).

Repo setup: MIT; 100% coverage + Codecov (needs a token while private); Dependabot grouped, 1-week cooldown, automerge; labeler; actionlint; oxlint (200 lines/file) + oxfmt; `ubuntu-slim`; latest deps.

## Milestones

1. **Scaffold + relay.** Repo setup, protocol, normalizers, Lambda, template, `deploy`, `token`. Deploy check on Vouchington: real delivery volume, 413s, cold start, Cost Explorer.
2. **Runner core.** Poll/cursor, rules, queue + concurrency, lifted runners and worktrees, local logs, `tail`/`wait`.
3. **Migrate ejections + fix-main.** Enable in hook-harness, flip `HARNESS_MERGE_QUEUE_EJECTION_ENABLED` / fix-main gate off, compare for a few days, delete workflows.
4. **Comment commands** (`fix-issue`, `plan`, `shepherd` incl. resume).
5. **Schedules** (`scheduled-prompts`) and **fix-dependabot** (decide: keep its rerun step as a workflow or move it into the runner).
6. **Retire auto-harness** after all surfaces are migrated.

pr-shepherd integration is out of scope for now.

## Risks

| Risk                                   | Mitigation                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| Host down                              | Events wait up to a day; `onGap` sweeps after longer outages                                 |
| Missed webhook / 413                   | Best-effort; visible in App delivery log; scheduled sweeps cover ejections and main failures |
| Comment-command abuse on a public repo | `authorAssociation` minimum per rule; command allowlist                                      |
| Prompt injection via event strings     | Payload text is untrusted; `--no-payload`; external-data labelling                           |
| Free-tier sharing in the AWS account   | On-demand switch; cost is cents either way                                                   |

## Verification

- Unit: Vitest 100% (signature, normalization per event, token scope, key-condition bounds, dedupe, rule matching, concurrency join, cooldown fallback, gap).
- E2E on a test repo with a real App: deploy, event → session starts within one poll, revoked token refused, tampered signature refused, forced ejection runs the ejection rule.
- Migration: per surface, hook-harness results match auto-harness for several days before the workflow is deleted.
