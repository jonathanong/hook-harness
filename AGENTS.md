# Agent instructions

- pnpm workspace, Node 24+. Source is TypeScript run with Node's native type stripping; only the relay is bundled (esbuild) for Lambda.
- `pnpm check` runs lint (oxlint, 200 lines per file), format check (oxfmt), typecheck, and tests with 100% coverage.
- Tests live next to source as `*.test.ts`.
- The relay stores signals only: never persist titles, bodies, comment text, or logs.
- Do not use `gh pr checks`; use `pr-shepherd`.
