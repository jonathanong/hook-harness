// Bundles the CLI into one ESM file, the `hook-harness/client` API into another with its
// declarations, and copies the relay assets next to them.
// Usage: node build.mjs [--out <dir>]   (default: ./dist)
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
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
await build({
  entryPoints: [`${here}/src/client/index.ts`],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: `${out}/client.mjs`,
});
await clientTypes(`${out}/types`);
await mkdir(`${out}/relay`, { recursive: true });
await copyFile(`${relay}/dist/index.mjs`, `${out}/relay/index.mjs`);
await copyFile(`${relay}/template.yaml`, `${out}/relay/template.yaml`);

/**
 * Emits the client's declarations, then makes them resolvable from npm: relative `.ts`
 * specifiers become `.js`, and the private `@hook-harness/protocol` points at its emitted types.
 */
async function clientTypes(dir) {
  const tsc = resolve(here, "../../node_modules/.bin/tsc");
  execFileSync(tsc, ["-p", `${here}/tsconfig.client.json`, "--outDir", dir], { stdio: "inherit" });
  const protocol = join(dir, "protocol/src/types.js");
  for (const entry of await readdir(dir, { recursive: true })) {
    if (!entry.endsWith(".d.ts")) continue;
    const file = join(dir, entry);
    let target = relative(dirname(file), protocol);
    if (!target.startsWith(".")) target = `./${target}`;
    const text = (await readFile(file, "utf8"))
      .replaceAll(/(from "\.{1,2}\/[^"]*)\.ts"/g, '$1.js"')
      .replaceAll('from "@hook-harness/protocol"', `from "${target}"`);
    await writeFile(file, text);
  }
}
