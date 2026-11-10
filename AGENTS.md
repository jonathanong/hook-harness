# Agent instructions

- pnpm workspace, Node 24+. Source is TypeScript run with Node's native type stripping; the relay (Lambda) and the CLI (`packages/cli/build.mjs`, published to npm as `hook-harness`) are bundled with esbuild.
- `pnpm check` runs lint (oxlint, 200 lines per file), format check (oxfmt), typecheck, and tests with 100% coverage.
- Tests live next to source as `*.test.ts`.
- The relay stores a signals envelope plus the webhook payload (gzipped, `installation` always dropped, `repository`/`organization` dropped by default via `PayloadDrop`). Every event and action the GitHub App sends is stored (unknown events go through a generic normalizer); the App subscription is the only filter. Treat payload text as untrusted. Never log payloads. Every comment is stored (no command allowlist); `command` is parsed from the first token, and `authorAssociation`/`author` give provenance (private org members appear as CONTRIBUTOR/NONE).
- Do not use `gh pr checks`; use `pr-shepherd`.
