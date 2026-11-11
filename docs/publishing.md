# Publishing `hook-harness` to npm

The CLI (`packages/cli`) is published as `hook-harness`. It ships one bundled ESM file
(`dist/bin.mjs`, protocol and AWS SDK inlined) plus the relay assets `deploy`/`update` upload
(`dist/relay/index.mjs`, `dist/relay/template.yaml`). Releases are published by
`.github/workflows/publish.yml` using npm trusted publishing (OIDC, provenance, no `NPM_TOKEN`).

npm only lets you attach a trusted publisher to a package that exists, or to a _pending_ publisher
configured for a name that does not exist yet. Pick one of the two first-publish options.

## Option A: pending trusted publisher (no manual publish)

1. Sign in to npmjs.com as the account that should own the package.
2. Go to <https://www.npmjs.com/settings/~/packages> (Packages, then "Trusted publishers" for a
   new package) and add a pending publisher for package name `hook-harness`.
3. Choose GitHub Actions and enter: owner `jonathanong`, repository `hook-harness`, workflow
   filename `publish.yml`, environment blank.
4. Continue with "Releasing" below; the first release creates the package.

## Option B: bootstrap publish, then configure the publisher

From a clean checkout of `main`, logged in with `npm login` (2FA on):

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
cd packages/cli && npm publish --access public --provenance=false
```

Use `npm publish` rather than `pnpm publish`: npm handles the browser 2FA prompt, while pnpm fails
with a 404.

Then add the trusted publisher (npm 11.10 or newer; prompts for 2FA):

```sh
npm trust github hook-harness --repo jonathanong/hook-harness --file publish.yml --allow-publish
npm trust list hook-harness
```

Optionally set "Require two-factor authentication and disallow tokens" on npmjs.com afterwards,
since CI no longer needs a token.

A bootstrap publish has no provenance attestation; later releases do.

## Releasing

1. Bump `version` in `packages/cli/package.json` (and the plugin manifests) and merge to `main`.
   That merge is the release; there is no manual step.
2. `publish.yml` runs on any push to `main` that touches `packages/cli/package.json`. If npm
   doesn't have that version yet, it runs `pnpm check` and `pnpm build`, then `npm publish` with
   provenance. It installs npm 12 first because OIDC publishing requires npm 11.5.1 or newer.
   (`pnpm publish` can't attach provenance in this setup.)
3. If there is no `v<version>` GitHub release yet, it creates one on that commit with generated
   notes.
4. Steps already done are skipped, so a re-run (or `workflow_dispatch`) after a partial failure
   finishes the job, and package.json changes that don't bump the version do nothing.
5. `npm view hook-harness version` can lag by a minute or two.

The relay is not part of this: deploy it with `hook-harness update` after relay changes merge.

## Verify an install

```sh
npx hook-harness --help
pnpm add -g hook-harness && hook-harness status --help
```
