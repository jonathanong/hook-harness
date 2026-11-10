import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { configDir, readState, removeState, statePath, writeState } from "./state.ts";

const state = {
  stack: "s",
  functionUrl: "https://x/",
  webhookUrl: "https://x/webhook",
  functionName: "f",
  tableName: "t",
  updatedAt: "2026-11-09T00:00:00.000Z",
};

describe("configDir", () => {
  it("prefers the explicit override, then XDG, then ~/.config", () => {
    expect(configDir({ HOOK_HARNESS_CONFIG_DIR: "/a", XDG_CONFIG_HOME: "/b" })).toBe("/a");
    expect(configDir({ XDG_CONFIG_HOME: "/b" })).toBe("/b/hook-harness");
    expect(configDir({})).toMatch(/\.config[\\/]hook-harness$/);
  });
});

describe("state files", () => {
  it("writes mode 0600, reads back, and removes", async () => {
    const env = { HOOK_HARNESS_CONFIG_DIR: await mkdtemp(join(tmpdir(), "hh-state-")) };
    expect(await readState(env, "s")).toBeUndefined();
    const path = await writeState(env, state);
    expect(path).toBe(statePath(env, "s"));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readState(env, "s")).toEqual(state);
    await removeState(env, "s");
    expect(await readState(env, "s")).toBeUndefined();
    await removeState(env, "s");
  });
});
