import { describe, expect, it } from "vitest";

import { BEAT_MS, openStream, POLL_MS, startDaemon, until } from "../test-helpers/serve.ts";
import { ev, page } from "../test-helpers/watch.ts";
import { decodeCursor, encodeCursor } from "../watch/cursor.ts";
import { readCursor } from "../watch/store.ts";

const envelopeIds = (stream: Awaited<ReturnType<typeof openStream>>) =>
  stream.ids().map((item) => (JSON.parse(item.data) as { id: string }).id);

describe("serve streaming", () => {
  it("streams envelopes with id/event/data and applies per-client filters", async () => {
    const d = await startDaemon([
      page([], "s0"),
      page([ev("a", 1), ev("b", 2, { event: "push" })], "s1"),
    ]);
    const all = await openStream(`${d.url}/events`);
    const pushes = await openStream(`${d.url}/events?event=push&repo=o/r`);
    const either = await openStream(
      `${d.url}/events?filter=${encodeURIComponent('{"event":"push"}')}&filter=${encodeURIComponent('{"pr":9}')}`,
    );
    expect(all.response.headers.get("content-type")).toBe("text/event-stream");
    await d.polled(1);
    await d.poll(2);
    await until(
      () => all.ids().length === 2 && pushes.ids().length === 1 && either.ids().length === 1,
    );
    expect(envelopeIds(all)).toEqual(["a", "b"]);
    expect(envelopeIds(pushes)).toEqual(["b"]);
    const first = all.ids()[0]!;
    expect(decodeCursor(first.id!)).toEqual({ sk: "s1", seen: ["a"] });
    expect(JSON.parse(first.data)).toMatchObject({ id: "a", event: "pull_request" });
    expect(d.h.err).toEqual([]);
    d.h.abort();
    expect(await d.done).toBe(0);
    await Promise.all([all.pump, pushes.pump, either.pump]);
  });

  it("replays from Last-Event-ID or ?after=, applying the client's filters", async () => {
    const d = await startDaemon([
      page([ev("a", 1), ev("b", 2, { event: "push" }), ev("c", 3)], "s1"),
    ]);
    await d.polled(1);
    const afterA = cursorFor("a");
    const viaHeader = await openStream(`${d.url}/events`, { headers: { "last-event-id": afterA } });
    const viaQuery = await openStream(`${d.url}/events?event=push&after=${afterA}`);
    const caughtUp = await openStream(`${d.url}/events?after=${cursorFor("c")}`);
    await until(() => viaHeader.ids().length === 2 && viaQuery.ids().length === 1);
    expect(envelopeIds(viaHeader)).toEqual(["b", "c"]);
    expect(envelopeIds(viaQuery)).toEqual(["b"]);
    expect(envelopeIds(caughtUp)).toEqual([]);
    d.h.abort();
    await d.done;
  });
});

/** A client position after delivery `id` (the buffer finds it by delivery id). */
const cursorFor = (id: string): string => encodeCursor({ sk: "x", seen: [id] });

describe("serve heartbeat, gaps, errors and shutdown", () => {
  it("sends ping comments on the heartbeat", async () => {
    const d = await startDaemon([page([], "s0")]);
    const stream = await openStream(`${d.url}/events`);
    await until(() => stream.comments().length === 1);
    d.gate.tick(BEAT_MS);
    await until(() => stream.comments().some((item) => item.text === "ping"));
    d.h.abort();
    await d.done;
  });

  it("sends event: gap for positions older than the buffer and for relay gaps", async () => {
    const d = await startDaemon([page([ev("a", 1)], "s1"), page([], "s2", true)]);
    await d.polled(1);
    const stale = await openStream(`${d.url}/events?after=${cursorFor("gone")}`);
    await until(() => stale.messages().some((item) => item.event === "gap"));
    const gap = stale.messages().find((item) => item.event === "gap")!;
    expect(decodeCursor(JSON.parse(gap.data).cursor).seen).toEqual(["a"]);
    await d.poll(2);
    await until(() => stale.messages().filter((item) => item.event === "gap").length === 2);
    d.h.abort();
    await d.done;
  });

  it("reports relay errors in /healthz, retries, and recovers", async () => {
    const d = await startDaemon([new Error("blip"), page([ev("a", 1)], "s1")]);
    await d.polled(1);
    const down = (await (await fetch(`${d.url}/healthz`)).json()) as Record<string, any>;
    expect(down).toMatchObject({ ok: false, clients: 0, buffered: 0 });
    expect(down.upstream.lastError).toBe("blip");
    expect(d.h.err).toEqual(["warning: blip; retrying"]);
    d.gate.tick(POLL_MS * 2);
    await d.polled(2);
    const up = (await (await fetch(`${d.url}/healthz`)).json()) as Record<string, any>;
    expect(up).toMatchObject({ ok: true, buffered: 1 });
    expect(up.upstream.lastError).toBeNull();
    expect(up.upstream.lastPollAt).toBe(new Date(d.h.clock.ms).toISOString());
    expect(decodeCursor(up.upstream.cursor).sk).toBe("s1");
    d.h.abort();
    await d.done;
  });

  it("counts clients, forgets disconnected ones, and saves the cursor on shutdown", async () => {
    const d = await startDaemon([page([ev("a", 1)], "s1")], ["--cursor", "mine"]);
    await d.polled(1);
    const health = async () =>
      (await (await fetch(`${d.url}/healthz`)).json()) as { clients: number };
    const stream = await openStream(`${d.url}/events`);
    await until(() => stream.comments().length > 0);
    expect((await health()).clients).toBe(1);
    stream.close();
    for (let i = 0; i < 200 && (await health()).clients !== 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect((await health()).clients).toBe(0);

    const open = await openStream(`${d.url}/events`);
    await until(() => open.comments().length > 0);
    d.h.abort();
    expect(await d.done).toBe(0);
    await open.pump;
    expect(open.isEnded()).toBe(true);
    expect(decodeCursor((await readCursor(d.h.ctx.env, "mine"))!).sk).toBe("s1");
    await expect(fetch(`${d.url}/healthz`)).rejects.toThrow();
  });

  it("exits with an error after closing streams when the relay rejects the token", async () => {
    const d = await startDaemon([page([], "s0"), new Response("no", { status: 401 })]);
    const stream = await openStream(`${d.url}/events`);
    await d.polled(1);
    d.gate.tick(POLL_MS);
    await expect(d.done).rejects.toThrow("relay rejected the token");
    await stream.pump;
    expect(stream.isEnded()).toBe(true);
  });
});
