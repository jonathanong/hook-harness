// Bundles the CLI into one ESM file and copies the relay assets next to it.
// Usage: node build.mjs [--out <dir>]   (default: ./dist)
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const flag = process.argv.indexOf("--out");
const out = resolve(flag > 0 ? process.argv[flag + 1] : `${here}/dist`);
const relay = resolve(here, "../relay");

await rm(out, { recursive: true, force: true });
await build({
  entryPoints: [`${here}/src/bin.ts`],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: `${out}/bin.mjs`,
  banner: {
    // esbuild keeps bin.ts's `#!/usr/bin/env node` as line 1; the banner follows it.
    js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);",
  },
});
await mkdir(`${out}/relay`, { recursive: true });
await copyFile(`${relay}/dist/index.mjs`, `${out}/relay/index.mjs`);
await copyFile(`${relay}/template.yaml`, `${out}/relay/template.yaml`);
