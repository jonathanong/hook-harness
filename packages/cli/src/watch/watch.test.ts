import { describe, expect, it } from "vitest";

import { defaultCtx } from "../ctx.ts";
import { parseDuration, parseSince } from "../duration.ts";
import { ev, page } from "../test-helpers/watch.ts";
import { advance, decodeCursor, encodeCursor } from "./cursor.ts";
import { readCursor, stateDir, writeCursor } from "./store.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("cursor", () => {
  it("round-trips as base64url JSON", () => {
    const cursor = { sk: "123#abc", seen: ["a", "b"] };
    const text = encodeCursor(cursor);
    expect(text).toMatch(/^[\w-]+$/);
    expect(JSON.parse(Buffer.from(text, "base64url").toString())).toEqual({ v: 1, ...cursor });
    expect(decodeCursor(text)).toEqual(cursor);
  });

  it("keeps only IDs within the overlap window and caps the list", () => {
    const old = ev("old", 0);
    const recent = ev("recent", 100);
    const { next } = advance({ sk: "a", seen: [] }, page([old, recent], "b"));
    expect(next).toEqual({ sk: "b", seen: ["recent"] });

    const many = Array.from({ length: 1050 }, (_, i) => ev(`e${i}`, 1000));
    const capped = advance({ sk: "a", seen: [] }, page(many, "c")).next.seen;
    expect(capped).toHaveLength(1000);
    expect(capped.at(-1)).toBe("e1049");
  });

  it("keeps the previous seen list for an empty page", () => {
    const { fresh, next } = advance({ sk: "a", seen: ["x"] }, page([], "b"));
    expect(fresh).toEqual([]);
    expect(next).toEqual({ sk: "b", seen: ["x"] });
  });
});

describe("durations", () => {
  it("parses units and zero handling", () => {
    expect(parseDuration("500ms", "x")).toBe(500);
    expect(parseDuration("15s", "x")).toBe(15_000);
    expect(parseDuration("2m", "x")).toBe(120_000);
    expect(parseDuration("1h", "x")).toBe(3_600_000);
    expect(parseDuration("1d", "x")).toBe(86_400_000);
    expect(parseDuration("0s", "x", true)).toBe(0);
    expect(() => parseDuration("0s", "x")).toThrow("invalid --x");
    expect(() => parseDuration("5", "x")).toThrow("invalid --x");
  });

  it("parses --since forms", () => {
    expect(parseSince("0s", 1000)).toBe(1000);
    expect(parseSince("1s", 5000)).toBe(4000);
    expect(parseSince("2026-11-09T00:00:00Z", 0)).toBe(Date.parse("2026-11-09T00:00:00Z"));
    expect(() => parseSince("nope", 0)).toThrow("ISO 8601");
  });
});

describe("cursor store", () => {
  it("resolves the state dir", () => {
    expect(stateDir({ HOOK_HARNESS_STATE_DIR: "/a" })).toBe("/a");
    expect(stateDir({ XDG_STATE_HOME: "/b" })).toBe("/b/hook-harness");
    expect(stateDir({})).toMatch(/\.local[\\/]state[\\/]hook-harness$/);
  });

  it("reads back what it wrote and tolerates missing files", async () => {
    const env = { HOOK_HARNESS_STATE_DIR: mkdtempSync(join(tmpdir(), "hh-store-")) };
    expect(await readCursor(env, "n")).toBeUndefined();
    await writeCursor(env, "n", "abc");
    expect(await readCursor(env, "n")).toBe("abc");
  });
});

describe("default ctx sleep", () => {
  it("sleeps, and wakes early on abort", async () => {
    const controller = new AbortController();
    const ctx = defaultCtx({}, controller);
    await ctx.sleep(1, controller.signal);
    const pending = ctx.sleep(60_000, controller.signal);
    controller.abort();
    await pending;
    expect(ctx.signal.aborted).toBe(true);
  });
});
