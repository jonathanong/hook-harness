// Copies the CLI's version into the plugin manifests, so one release bumps every version.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("packages/cli/package.json", "utf8"));
const manifests = [
  ".claude-plugin/plugin.json",
  "plugins/hook-harness/.claude-plugin/plugin.json",
  "plugins/hook-harness/.codex-plugin/plugin.json",
];

for (const path of manifests) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.version = version;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log(manifests.join("\n"));
