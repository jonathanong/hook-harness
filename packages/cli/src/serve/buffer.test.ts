import { describe, expect, it } from "vitest";

import { ev } from "../test-helpers/watch.ts";
import { decodeCursor } from "../watch/cursor.ts";
import { RingBuffer } from "./buffer.ts";
import { envelopeFrame, gapFrame, PING } from "./frames.ts";
import { Hub, type Sink } from "./hub.ts";

const T0 = Date.parse("2026-11-09T00:00:00Z");

const fakeSink = (length = 0) => {
  const log: string[] = [];
  const sink: Sink & { log: string[]; ended: boolean; destroyed: boolean; length: number } = {
    log,
    ended: false,
    destroyed: false,
    length,
    write: (chunk) => (log.push(chunk), true),
    get writableLength() {
      return sink.length;
    },
    end: () => void (sink.ended = true),
    destroy: () => void (sink.destroyed = true),
  };
  return sink;
};

describe("RingBuffer", () => {
  const make = (over = {}) =>
    new RingBuffer({ maxEvents: 3, maxAgeMs: 60_000, floorMs: T0, ...over });

  it("bounds by count and raises the floor on eviction", () => {
    const buffer = make();
    for (const n of [1, 2, 3, 4]) buffer.push(ev(`e${n}`, n), `sk${n}`, T0 + n);
    expect(buffer.size).toBe(3);
    expect(buffer.entries[0]!.event.id).toBe("e2");
    expect(decodeCursor(buffer.head!)).toEqual({ sk: "sk4", seen: ["e4"] });
    expect(buffer.replay({ sk: String(T0 + 500), seen: [] }).gap).toBe(true);
    expect(buffer.replay({ sk: String(T0 + 2000), seen: [] }).gap).toBe(false);
  });

  it("evicts by age", () => {
    const buffer = make();
    buffer.push(ev("old", 1), "a", T0);
    buffer.push(ev("new", 2), "b", T0 + 50_000);
    buffer.prune(T0 + 70_000);
    expect(buffer.entries.map((entry) => entry.event.id)).toEqual(["new"]);
    buffer.prune(T0 + 200_000);
    expect(buffer.size).toBe(0);
    expect(buffer.head).toBeUndefined();
  });

  it("replays after a known delivery id, using the latest known one", () => {
    const buffer = make();
    for (const n of [1, 2, 3]) buffer.push(ev(`e${n}`, n), `sk${n}`, T0);
    const { gap, entries } = buffer.replay({ sk: "x", seen: ["e1", "e2", "zzz"] });
    expect(gap).toBe(false);
    expect(entries.map((entry) => entry.event.id)).toEqual(["e3"]);
  });

  it("falls back to time, and reports a gap for unusable cursors", () => {
    const buffer = make();
    for (const n of [1, 2, 3]) buffer.push(ev(`e${n}`, n), `sk${n}`, T0);
    const byTime = buffer.replay({ sk: `${T0 + 1000}#abc`, seen: [] });
    expect(byTime.entries.map((entry) => entry.event.id)).toEqual(["e2", "e3"]);
    expect(buffer.replay({ sk: "not-a-time", seen: [] })).toEqual({ gap: true, entries: [] });
    expect(buffer.replay({ sk: String(T0 - 1), seen: [] }).gap).toBe(true);
  });
});

describe("Hub", () => {
  const entry = new RingBuffer({ maxEvents: 9, maxAgeMs: 9e9, floorMs: 0 }).push(
    ev("a", 1),
    "s",
    0,
  );

  it("publishes to matching clients, and broadcasts gaps and pings", () => {
    const hub = new Hub(100);
    const all = fakeSink();
    const push = fakeSink();
    hub.add(all, []);
    hub.add(push, [{ event: "push" }]);
    hub.publish(entry);
    hub.gap("cur");
    hub.ping();
    expect(all.log).toEqual([envelopeFrame(entry), gapFrame("cur"), PING]);
    expect(push.log).toEqual([gapFrame("cur"), PING]);
    expect(hub.size).toBe(2);
  });

  it("destroys and removes clients with too many unsent bytes", () => {
    const hub = new Hub(10);
    const slow = fakeSink(11);
    const fine = fakeSink(10);
    hub.add(slow, []);
    hub.add(fine, []);
    hub.publish(entry);
    expect(slow.destroyed).toBe(true);
    expect(slow.log).toEqual([]);
    expect(fine.log).toHaveLength(1);
    expect(hub.size).toBe(1);
  });

  it("closes every client", () => {
    const hub = new Hub(10);
    const sink = fakeSink();
    const client = hub.add(sink, []);
    hub.remove(client);
    hub.add(sink, []);
    hub.closeAll();
    expect(sink.ended).toBe(true);
    expect(hub.size).toBe(0);
  });
});
