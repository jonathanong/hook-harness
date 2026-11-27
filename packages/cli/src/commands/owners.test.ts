import { describe, expect, it } from "vitest";

import { gatedSleep, openStream, until } from "../test-helpers/serve.ts";
import { ev, lastLine, ownersHarness, page } from "../test-helpers/watch.ts";
import { decodeCursor, encodeCursor } from "../watch/cursor.ts";
import { readCursor, writeCursor } from "../watch/store.ts";
import { serve } from "./serve.ts";
import { tail } from "./tail.ts";
import { wait } from "./wait.ts";

const afters = (h: Awaited<ReturnType<typeof ownersHarness>>) =>
  h.calls.urls.map((url) => [url.searchParams.get("owner"), url.searchParams.get("after")]);

describe("several owners", () => {
  it("polls each owner and returns one cursor covering all of them", async () => {
    const h = await ownersHarness({
      a: [page([ev("a1", 2, { owner: "a" })], "sa")],
      b: [page([ev("b1", 1, { owner: "b" })], "sb")],
    });
    expect(await wait(["--owner", "A,b", "--owner", "a", "--on", "label:x,/y"], h.ctx)).toBe(0);
    const result = lastLine(h) as { events: Array<{ id: string; owner: string }>; cursor: string };
    expect(result.events).toEqual([]);
    expect(new Set(afters(h).map(([owner]) => owner))).toEqual(new Set(["a", "b"]));
    expect(decodeCursor(result.cursor).owners).toEqual({
      a: { sk: "sa", seen: ["a1"] },
      b: { sk: "sb", seen: ["b1"] },
    });
    expect(await readCursor(h.ctx.env, "default")).toBe(result.cursor);
  });

  it("returns matches from every owner in time order", async () => {
    const h = await ownersHarness({
      a: [page([ev("a1", 2, { owner: "a" })], "sa")],
      b: [page([ev("b1", 1, { owner: "b" })], "sb")],
    });
    await wait(["--owner", "a,b"], h.ctx);
    const events = lastLine(h).events as Array<{ id: string; owner: string }>;
    expect(events.map((event) => [event.id, event.owner])).toEqual([
      ["b1", "b"],
      ["a1", "a"],
    ]);
  });

  it("resumes each owner from its own position", async () => {
    const h = await ownersHarness({ a: [page([], "sa2")], b: [page([], "sb2")] });
    const after = encodeCursor({
      sk: "",
      seen: [],
      owners: { a: { sk: "100", seen: [] }, b: { sk: "200", seen: [] } },
    });
    await wait(["--owner", "a,b", "--after", after, "--timeout", "1s"], h.ctx);
    expect(afters(h).slice(0, 2).sort()).toEqual([
      ["a", "100"],
      ["b", "200"],
    ]);
  });

  it("starts every owner from a single-owner cursor, and a new owner from now", async () => {
    const h = await ownersHarness({ a: [page([])], b: [page([])], c: [page([])] });
    await writeCursor(h.ctx.env, "default", encodeCursor({ sk: "100", seen: [] }));
    await wait(["--owner", "a,b", "--timeout", "1s"], h.ctx);
    expect(afters(h).slice(0, 2).sort()).toEqual([
      ["a", "100"],
      ["b", "100"],
    ]);

    const saved = decodeCursor((await readCursor(h.ctx.env, "default"))!);
    h.calls.urls.length = 0;
    const now = String(h.clock.ms);
    await wait(["--owner", "a,c", "--timeout", "1s"], h.ctx);
    expect(afters(h).slice(0, 2).sort()).toEqual([
      ["a", saved.owners!.a!.sk],
      ["c", now],
    ]);
    expect(Object.keys(decodeCursor(lastLine(h).cursor as string).owners!)).toEqual(["a", "c"]);
  });

  it("drops back to a single-owner cursor when one owner is left", async () => {
    const h = await ownersHarness({ a: [page([], "sa")] });
    const after = encodeCursor({
      sk: "",
      seen: [],
      owners: { a: { sk: "100", seen: ["x"] }, b: { sk: "200", seen: [] } },
    });
    await wait(["--owner", "a", "--after", after, "--timeout", "1s"], h.ctx);
    expect(afters(h)[0]).toEqual(["a", "100"]);
    expect(decodeCursor(lastLine(h).cursor as string)).toEqual({ sk: "sa", seen: ["x"] });
  });

  it("reports a gap from any owner", async () => {
    const h = await ownersHarness({ a: [page([], "sa")], b: [page([], "sb", true)] });
    await wait(["--owner", "a,b"], h.ctx);
    expect(lastLine(h).gap).toBe(true);
  });

  it("names the owner the token does not cover", async () => {
    const h = await ownersHarness({
      a: [page([])],
      b: [Response.json({ error: "forbidden" }, { status: 403 })],
    });
    await expect(wait(["--owner", "a,b"], h.ctx)).rejects.toThrow('does not cover owner "b"');
  });

  it("tails several owners, naming the owner on gaps and errors", async () => {
    const h = await ownersHarness({
      a: [page([ev("a1", 1, { owner: "a" })], "sa"), () => (h.abort(), page([]))],
      b: [new Error("offline"), page([], "sb", true)],
    });
    expect(await tail(["--owner", "a,b"], h.ctx)).toBe(0);
    expect(h.err).toContain("warning: b: offline; retrying");
    const lines = h.out.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.some((line) => (line.event as { id?: string } | undefined)?.id === "a1")).toBe(
      true,
    );
    expect(lines.find((line) => line.gap)).toMatchObject({ gap: true, owner: "b" });
  });

  it("serves several owners from one poller", async () => {
    const h = await ownersHarness({
      a: [page([ev("a1", 1, { owner: "a" })], "sa")],
      b: [page([ev("b1", 2, { owner: "b" })], "sb")],
    });
    h.ctx.sleep = gatedSleep().sleep;
    const done = serve(["--owner", "a,b", "--port", "0", "--interval", "20s"], h.ctx);
    await until(() => h.out.some((line) => line.includes("listening")), "listening");
    const url = /http:\/\/\S+/.exec(h.out[0]!)![0];
    const health = async () =>
      (await (await fetch(`${url}/healthz`)).json()) as { upstream: { cursor: string } };
    await until(() => h.calls.urls.length >= 2, "both polls");
    let owners: Record<string, { sk: string }> | undefined;
    for (let i = 0; i < 100 && (owners?.a?.sk !== "sa" || owners.b?.sk !== "sb"); i += 1) {
      owners = decodeCursor((await health()).upstream.cursor).owners;
    }
    expect(owners).toEqual({ a: { sk: "sa", seen: ["a1"] }, b: { sk: "sb", seen: ["b1"] } });

    const from = encodeCursor({ sk: String(Date.parse("2026-11-09T00:00:00Z")), seen: [] });
    const stream = await openStream(`${url}/events?after=${from}`);
    await until(() => stream.ids().length === 2, "replay");
    const ids = stream.ids().map((item) => (JSON.parse(item.data) as { id: string }).id);
    expect(ids.sort()).toEqual(["a1", "b1"]);
    h.abort();
    expect(await done).toBe(0);
    await stream.pump;
    expect(decodeCursor((await readCursor(h.ctx.env, "default"))!).owners).toEqual(owners);
  });
});
