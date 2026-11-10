import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "../watch/cursor.ts";
import { readCursor } from "../watch/store.ts";
import { ev, lastLine, page, watchHarness } from "../test-helpers/watch.ts";
import { wait } from "./wait.ts";

const START = Date.parse("2026-11-09T00:00:00Z");

describe("wait", () => {
  it("prints one JSON object with the cursor and saves it afterwards", async () => {
    const h = await watchHarness([page([ev("a", 1)], "sk-a")]);
    expect(await wait(["--owner", "o", "--repo", "o/r,o/s", "--settle", "0s"], h.ctx)).toBe(0);
    expect(h.out).toHaveLength(1);
    const result = lastLine(h) as { events: unknown[]; gap: boolean; cursor: string };
    expect(result.events).toHaveLength(1);
    expect(result.gap).toBe(false);
    expect(decodeCursor(result.cursor)).toEqual({ sk: "sk-a", seen: ["a"] });
    expect(await readCursor(h.ctx.env, "default")).toBe(result.cursor);

    const url = h.calls.urls[0]!;
    expect(url.origin + url.pathname).toBe("https://relay.example/events");
    expect(url.searchParams.get("owner")).toBe("o");
    expect(url.searchParams.get("repos")).toBe("o/r,o/s");
    expect(url.searchParams.get("after")).toBe(String(START));
    expect(url.searchParams.get("limit")).toBe("100");
    expect(h.calls.headers[0]).toEqual({ authorization: "Bearer hh_token" });
  });

  it("keeps collecting for the settle window, then stops", async () => {
    const h = await watchHarness([page([ev("a", 1)], "s1"), page([ev("b", 2)], "s2")]);
    await wait(["--owner", "o"], h.ctx);
    expect(h.calls.times).toEqual([START, START + 10_000]);
    expect((lastLine(h).events as unknown[]).length).toBe(2);
  });

  it("skips non-matching events but still advances, then times out with exit 0", async () => {
    const h = await watchHarness([page([ev("a", 1, { event: "push" })], "s1"), page([], "s2")]);
    expect(await wait(["--owner", "o", "--event", "pull_request", "--timeout", "30s"], h.ctx)).toBe(
      0,
    );
    const result = lastLine(h) as {
      events: unknown[];
      timedOut: boolean;
      gap: boolean;
      cursor: string;
    };
    expect(result.events).toEqual([]);
    expect(result.timedOut).toBe(true);
    expect(result.gap).toBe(false);
    expect(decodeCursor(result.cursor).sk).toBe("s2");
    expect(h.calls.times).toEqual([START, START + 15_000, START + 30_000]);
  });

  it("returns immediately on a gap with matches so far", async () => {
    const h = await watchHarness([page([ev("a", 1)], "s9", true)]);
    expect(await wait(["--owner", "o"], h.ctx)).toBe(0);
    expect(lastLine(h)).toMatchObject({ gap: true, events: [{ id: "a" }] });
    expect(h.calls.urls).toHaveLength(1);
  });

  it("does not sleep between full pages", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ev(`e${i}`, i, { event: "push" }));
    const h = await watchHarness([page(full, "s1"), page([ev("m", 200)], "s2")]);
    await wait(["--owner", "o", "--event", "pull_request", "--settle", "0s"], h.ctx);
    expect(h.calls.times).toEqual([START, START]);
  });
});

describe("wait resume precedence", () => {
  it("--after beats state, is stateless, and drops already-seen deliveries", async () => {
    const h = await watchHarness([page([ev("dup", 1), ev("new", 2)], "s2")]);
    const after = encodeCursor({ sk: "s1", seen: ["dup"] });
    await wait(["--owner", "o", "--after", after, "--settle", "0s"], h.ctx);
    expect(h.calls.urls[0]!.searchParams.get("after")).toBe("s1");
    expect(lastLine(h).events).toMatchObject([{ id: "new" }]);
    expect(await readCursor(h.ctx.env, "default")).toBeUndefined();
  });

  it("--after with --cursor still writes that state file", async () => {
    const h = await watchHarness([page([ev("a", 1)], "s2")]);
    const after = encodeCursor({ sk: "s1", seen: [] });
    await wait(["--owner", "o", "--after", after, "--cursor", "agent", "--settle", "0s"], h.ctx);
    expect(decodeCursor((await readCursor(h.ctx.env, "agent"))!).sk).toBe("s2");
  });

  it("uses the state file on the next run, but an explicit --since wins", async () => {
    const pages = [page([ev("a", 1)], "s2"), page([ev("b", 2)], "s3"), page([ev("c", 3)], "s4")];
    const h = await watchHarness(pages);
    await wait(["--owner", "o", "--settle", "0s"], h.ctx);
    await wait(["--owner", "o", "--settle", "0s"], h.ctx);
    expect(h.calls.urls[1]!.searchParams.get("after")).toBe("s2");
    expect(lastLine(h).events).toMatchObject([{ id: "b" }]);
    await wait(["--owner", "o", "--since", "2h", "--settle", "0s"], h.ctx);
    expect(h.calls.urls[2]!.searchParams.get("after")).not.toBe("s3");
  });

  it("--since accepts a duration or an ISO timestamp", async () => {
    const h = await watchHarness([page([ev("a", 1)], "s2")]);
    await wait(["--owner", "o", "--since", "2h", "--settle", "0s", "--cursor", "a"], h.ctx);
    await wait(
      ["--owner", "o", "--since", "2026-11-08T00:00:00Z", "--settle", "0s", "--cursor", "b"],
      h.ctx,
    );
    expect(h.calls.urls[0]!.searchParams.get("after")).toBe(String(START - 2 * 3600_000));
    expect(h.calls.urls[1]!.searchParams.get("after")).toBe(String(START - 86_400_000));
  });

  it("rejects malformed cursors with a clear message", async () => {
    const h = await watchHarness([page([])]);
    const bad = [
      "%%%",
      Buffer.from("not json").toString("base64url"),
      Buffer.from("null").toString("base64url"),
      Buffer.from(JSON.stringify({ v: 2, sk: "x", seen: [] })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, sk: 1, seen: [] })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, sk: "x", seen: "no" })).toString("base64url"),
      Buffer.from(JSON.stringify({ v: 1, sk: "x", seen: [1] })).toString("base64url"),
    ];
    for (const after of bad) {
      await expect(wait(["--owner", "o", "--after", after], h.ctx)).rejects.toThrow(
        "invalid cursor",
      );
    }
    expect(h.calls.urls).toHaveLength(0);
  });
});
