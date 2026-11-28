import { describe, expect, it, vi } from "vitest";

import { ev, page } from "../test-helpers/watch.ts";
import { decodeCursor, encodeCursor } from "../watch/cursor.ts";
import { UnauthorizedError } from "./errors.ts";
import { pollEvents, pollPages, type EventsBatch } from "./poll.ts";

type Answer = () => Response | Error;

/** A fetch that answers from `answers` in order (the last repeats) and records each `after`. */
function relay(answers: Answer[]) {
  const afters: Array<string | null> = [];
  const fetch = vi.fn(async (input: string | URL | Request) => {
    afters.push(new URL(String(input)).searchParams.get("after"));
    const answer = answers[Math.min(afters.length - 1, answers.length - 1)]!();
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { afters, fetch: fetch as unknown as typeof globalThis.fetch };
}

const sleeps: number[] = [];
const sleep = async (ms: number): Promise<void> => {
  sleeps.push(ms);
};
const conn = { url: "https://relay.example", token: "hh_t", owner: "o", sleep };

async function take<T>(source: AsyncGenerator<T>, count: number): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
    if (out.length === count) break;
  }
  return out;
}

describe("pollEvents", () => {
  it("drops the relay's overlap replay and filters locally", async () => {
    const r = relay([
      () => Response.json(page([ev("a", 1, { event: "push" }), ev("b", 2)], "c1")),
      () => Response.json(page([ev("b", 2), ev("c", 3, { event: "push" })], "c2")),
    ]);
    const batches = await take(
      pollEvents({ ...conn, fetch: r.fetch, since: new Date(1000), filters: [{ event: "push" }] }),
      2,
    );
    const ids = batches.map((b) => ("events" in b ? b.events.map((e) => e.id) : b.error));
    expect(ids).toEqual([["a"], ["c"]]);
    expect(r.afters).toEqual(["1000", "c1"]);
    const last = batches[1] as Extract<EventsBatch, { cursor: string }>;
    expect(decodeCursor(last.cursor)).toEqual({ sk: "c2", seen: ["b", "c"] });
  });

  it("resumes from a cursor without repeating the events it saw", async () => {
    const r = relay([() => Response.json(page([ev("b", 2), ev("c", 3)], "c3"))]);
    const after = encodeCursor({ sk: "c2", seen: ["b"] });
    const [batch] = await take(pollEvents({ ...conn, fetch: r.fetch, after }), 1);
    expect(batch).toMatchObject({ events: [{ id: "c" }], gap: false });
    expect(r.afters).toEqual(["c2"]);
  });

  it("takes this owner's position from a multi-owner cursor and starts now otherwise", async () => {
    vi.useFakeTimers({ now: 7000 });
    const r = relay([() => Response.json(page([]))]);
    const after = encodeCursor({
      sk: "1",
      seen: [],
      owners: { o: { sk: "5", seen: [] }, p: { sk: "1", seen: [] } },
    });
    await take(pollEvents({ ...conn, fetch: r.fetch, after }), 1);
    await take(pollEvents({ ...conn, fetch: r.fetch }), 1);
    vi.useRealTimers();
    expect(r.afters).toEqual(["5", "7000"]);
  });

  it("yields errors, backs off, and throws auth errors", async () => {
    sleeps.length = 0;
    const r = relay([() => new TypeError("fetch failed"), () => new Response("", { status: 401 })]);
    const source = pollEvents({ ...conn, fetch: r.fetch, intervalMs: 100 });
    expect((await source.next()).value).toEqual({ error: new TypeError("fetch failed") });
    await expect(source.next()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(sleeps).toEqual([200]);
  });
});

describe("pollPages", () => {
  it("follows a short page at once and otherwise sleeps the delay", async () => {
    sleeps.length = 0;
    const r = relay([
      () => Response.json({ ...page([], "c1"), more: true }),
      () => Response.json(page([], "c2")),
    ]);
    await take(pollPages({ ...conn, fetch: r.fetch, after: "0", delay: () => 42 }), 3);
    expect(sleeps).toEqual([0, 42]);
    expect(r.afters).toEqual(["0", "c1", "c2"]);
  });

  it("stops when the signal aborts, waking from the default sleep", async () => {
    const controller = new AbortController();
    const r = relay([() => Response.json(page([]))]);
    const source = pollPages({
      url: "https://relay.example",
      token: "hh_t",
      owner: "o",
      fetch: r.fetch,
      signal: controller.signal,
      after: "0",
      intervalMs: 60_000,
    });
    await source.next();
    const done = source.next();
    controller.abort();
    expect(await done).toEqual({ done: true, value: undefined });
  });
});
