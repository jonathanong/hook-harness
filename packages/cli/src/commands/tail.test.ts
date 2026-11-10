import { describe, expect, it } from "vitest";

import { ev, page, watchHarness } from "../test-helpers/watch.ts";
import { decodeCursor } from "../watch/cursor.ts";
import { readCursor } from "../watch/store.ts";
import { login } from "./login.ts";
import { tail } from "./tail.ts";

describe("tail", () => {
  it("streams matching events as NDJSON until interrupted, saving the cursor", async () => {
    const h = await watchHarness([
      page([ev("a", 1), ev("x", 2, { event: "push" })], "s1"),
      new Error("blip"),
      page([ev("a", 1), ev("b", 3)], "s2", true),
      () => {
        h.abort();
        return page([], "s3");
      },
    ]);
    expect(await tail(["--owner", "o", "--event", "pull_request"], h.ctx)).toBe(0);

    const lines = h.out.map((line) => JSON.parse(line));
    expect(lines.map((line) => line.event?.id ?? "gap")).toEqual(["a", "gap", "b"]);
    expect(decodeCursor(lines[0].cursor).sk).toBe("s1");
    expect(lines[1]).toMatchObject({ gap: true });
    expect(h.err).toEqual(["warning: blip; retrying"]);
    expect(decodeCursor((await readCursor(h.ctx.env, "default"))!).sk).toBe("s3");
  });

  it("prints help", async () => {
    const h = await watchHarness([page([])]);
    expect(await tail(["-h"], h.ctx)).toBe(0);
    expect(h.out[0]).toContain("NDJSON");
  });
});

describe("login", () => {
  it("saves url and token, which later commands pick up", async () => {
    const h = await watchHarness([page([ev("a", 1)])]);
    delete h.ctx.env.HOOK_HARNESS_URL;
    delete h.ctx.env.HOOK_HARNESS_TOKEN;
    expect(await login(["--url", "https://relay.example/", "--token", "hh_saved"], h.ctx)).toBe(0);
    expect(h.out[0]).toMatch(/Saved login to .*client\.json$/);
    const { wait } = await import("./wait.ts");
    await wait(["--owner", "o", "--settle", "0s"], h.ctx);
    expect(h.calls.headers[0]).toEqual({ authorization: "Bearer hh_saved" });
  });

  it("lets env vars override saved fields", async () => {
    const h = await watchHarness([page([ev("a", 1)])]);
    await login(["--url", "https://saved.example", "--token", "hh_saved"], h.ctx);
    const { wait } = await import("./wait.ts");
    await wait(["--owner", "o", "--settle", "0s"], h.ctx);
    expect(h.calls.urls[0]!.origin).toBe("https://relay.example");
    expect(h.calls.headers[0]).toEqual({ authorization: "Bearer hh_token" });
  });

  it("requires both flags and prints help", async () => {
    const h = await watchHarness([page([])]);
    await expect(login(["--url", "x"], h.ctx)).rejects.toThrow("--url and --token");
    await expect(login(["--token", "x"], h.ctx)).rejects.toThrow("--url and --token");
    expect(await login(["--help"], h.ctx)).toBe(0);
    expect(h.out[0]).toContain("hook-harness login");
  });
});
