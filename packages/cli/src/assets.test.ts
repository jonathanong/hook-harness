import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

  it("ships hook-harness/client with self-contained declarations", async () => {
    const types = join(out, "types");
    for (const entry of await readdir(types, { recursive: true })) {
      if (!entry.endsWith(".d.ts")) continue;
      const text = await readFile(join(types, entry), "utf8");
      expect(text, entry).not.toContain("@hook-harness/");
      expect(text, entry).not.toMatch(/from "[^"]*\.ts"/);
    }
    const client = await readFile(join(out, "client.mjs"), "utf8");
    expect(client).not.toMatch(/@aws-sdk|@modelcontextprotocol|^#!/m);
  });

  it("imports and typechecks hook-harness/client from an installed package", async () => {
    const app = await mkdtemp(join(tmpdir(), "hh-consumer-"));
    const pkgDir = join(app, "node_modules", "hook-harness");
    await mkdir(pkgDir, { recursive: true });
    await cp(join(cliDir, "package.json"), join(pkgDir, "package.json"));
    await cp(out, join(pkgDir, "dist"), { recursive: true });
    await writeFile(join(app, "package.json"), '{"type":"module"}');
    await writeFile(
      join(app, "use.ts"),
      [
        'import { fetchEventsPage, pollEvents, OutOfScopeError } from "hook-harness/client";',
        'import type { Envelope, EventFilter, EventsPage } from "hook-harness/client";',
        'const filter: EventFilter = { event: "push" };',
        "const page: Promise<EventsPage> = fetchEventsPage({",
        '  url: "u", token: "t", owner: "o", filters: [filter],',
        "});",
        "const ids = async (): Promise<string[]> => (await page).events.map((e: Envelope) => e.id);",
        'const batches = pollEvents({ url: "u", token: "t", owner: "o", on: ["ejection"] });',
        "export { batches, ids, OutOfScopeError };",
      ].join("\n"),
    );
    const tsc = join(root, "node_modules/.bin/tsc");
    const flags = ["--noEmit", "--strict", "--module", "nodenext", "--types", "node"];
    await run(tsc, [...flags, "--typeRoots", join(root, "node_modules/@types"), "use.ts"], {
      cwd: app,
    });
    const script =
      'import("hook-harness/client").then((m) => console.log(Object.keys(m).sort().join()))';
    const { stdout } = await run("node", ["--input-type=module", "-e", script], { cwd: app });
    expect(stdout.trim()).toBe(
      "AuthError,BadRequestError,NotLoggedInError,OutOfScopeError,RelayError,UnauthorizedError," +
        "fetchEventsPage,pollEvents,pollPages,resolveClient",
    );
    await rm(app, { recursive: true });
  }, 60_000);
});
