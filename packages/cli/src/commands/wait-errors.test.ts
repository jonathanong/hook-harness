import { describe, expect, it } from "vitest";

import { ev, lastLine, page, watchHarness } from "../test-helpers/watch.ts";
import { wait } from "./wait.ts";

const START = Date.parse("2026-11-09T00:00:00Z");

describe("wait failures", () => {
  it("retries transient errors with backoff and then succeeds", async () => {
    const h = await watchHarness([
      new Error("offline"),
      new Response("", { status: 503 }),
      page([ev("a", 1)], "s1"),
    ]);
    expect(await wait(["--owner", "o", "--settle", "0s"], h.ctx)).toBe(0);
    expect(h.calls.times).toEqual([START, START + 30_000, START + 90_000]);
    expect(lastLine(h).events).toHaveLength(1);
  });

  it("exits with the error when the relay stays down past --timeout", async () => {
    const h = await watchHarness([new Error("offline")]);
    await expect(wait(["--owner", "o", "--timeout", "1m"], h.ctx)).rejects.toThrow("offline");
    expect(h.out).toEqual([]);
  });

  it("delivers matches collected before an error during settle", async () => {
    const h = await watchHarness([page([ev("a", 1)], "s1"), new Error("blip")]);
    expect(await wait(["--owner", "o"], h.ctx)).toBe(0);
    expect(lastLine(h).events).toHaveLength(1);
  });

  it("fails clearly on 401 and 403 without retrying", async () => {
    for (const status of [401, 403]) {
      const h = await watchHarness([new Response("", { status })]);
      await expect(wait(["--owner", "o"], h.ctx)).rejects.toThrow(`HTTP ${status}`);
      expect(h.calls.urls).toHaveLength(1);
    }
  });

  it("exits 130 when interrupted before delivering", async () => {
    const h = await watchHarness([
      () => {
        h.abort();
        return page([]);
      },
    ]);
    expect(await wait(["--owner", "o"], h.ctx)).toBe(130);
    expect(h.out).toEqual([]);
  });
});
