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
pnpm publish --filter hook-harness --no-git-checks --access public
```

Then on npmjs.com open the `hook-harness` package, Settings, "Trusted publisher", choose GitHub
Actions and enter: organization/user `jonathanong`, repository `hook-harness`, workflow filename
`publish.yml`, environment blank. Optionally set "Require two-factor authentication and disallow
tokens" afterwards, since CI no longer needs a token.

A bootstrap publish has no provenance attestation; later releases do.

## Releasing

1. Bump `version` in `packages/cli/package.json`, merge to `main`.
2. Create a GitHub release with tag `v<version>` (for example `v0.1.1`) and publish it.
3. The workflow checks the tag matches the package version, runs `pnpm check` and `pnpm build`,
   and runs `pnpm publish --filter hook-harness --no-git-checks`. It installs npm 12 first because
   OIDC publishing requires npm 11.5.1 or newer, and `pnpm publish` delegates to the npm on PATH.

Version `0.1.0` is already set; the first release tag is `v0.1.0`. A version can be published
only once, so if Option B published `0.1.0`, bump before the first CI release.

## Verify an install

```sh
npx hook-harness --help
pnpm add -g hook-harness && hook-harness status --help
```
