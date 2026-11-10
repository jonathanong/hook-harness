import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveRelayAssets } from "./assets.ts";

const run = promisify(execFile);
const cliDir = fileURLToPath(new URL("..", import.meta.url));
const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("resolveRelayAssets", () => {
  it("prefers dist/relay next to the module when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hh-assets-"));
    await mkdir(join(dir, "relay"));
    await writeFile(join(dir, "relay", "template.yaml"), "");
    const assets = resolveRelayAssets(pathToFileURL(join(dir, "bin.mjs")).href);
    expect(assets).toEqual({
      template: join(dir, "relay", "template.yaml"),
      bundle: join(dir, "relay", "index.mjs"),
    });
    await rm(dir, { recursive: true });
  });

  it("falls back to the repo's relay package", () => {
    const assets = resolveRelayAssets(import.meta.url);
    expect(assets.template).toMatch(/packages[\\/]relay[\\/]template\.yaml$/);
    expect(assets.bundle).toMatch(/packages[\\/]relay[\\/]dist[\\/]index\.mjs$/);
  });
});

describe("build output", () => {
  let out: string;
  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), "hh-build-"));
    if (!existsSync(join(root, "packages/relay/dist/index.mjs"))) {
      await run("pnpm", ["--filter", "@hook-harness/relay", "run", "build"], { cwd: root });
    }
    await run("node", [join(cliDir, "build.mjs"), "--out", out]);
  }, 120_000);
  afterAll(() => rm(out, { recursive: true, force: true }));

  it("ships the relay assets and resolves them from the bundle location", () => {
    const assets = resolveRelayAssets(pathToFileURL(join(out, "bin.mjs")).href);
    expect(existsSync(assets.template)).toBe(true);
    expect(existsSync(assets.bundle)).toBe(true);
    expect(assets.bundle).toBe(join(out, "relay", "index.mjs"));
  });

  it("keeps exactly one shebang on line 1", async () => {
    const text = await readFile(join(out, "bin.mjs"), "utf8");
    expect(text.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(text.match(/^#!/gm)).toHaveLength(1);
  });

  it("runs from the bundle with no workspace resolution", async () => {
    const { stdout } = await run("node", [join(out, "bin.mjs"), "status", "--help"]);
    expect(stdout).toContain("hook-harness status");
  });
});
