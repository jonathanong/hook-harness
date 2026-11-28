import { describe, expect, it, vi } from "vitest";

import { ev, page } from "../test-helpers/watch.ts";
import { decodeCursor, encodeCursor } from "../watch/cursor.ts";
import { BadRequestError, UnauthorizedError } from "./errors.ts";
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
    expect((await source.next()).value).toEqual({
      error: new TypeError("fetch failed"),
      owner: "o",
    });
    await expect(source.next()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(sleeps).toEqual([200]);
  });
});

describe("pollEvents with several owners", () => {
  /** Sleeps until the poll stops, so each owner polls once. */
  const parked = (_ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => signal.addEventListener("abort", () => resolve()));
  /** A fetch that answers each owner from its own pages (the last repeats). */
  function owners(pages: Record<string, Array<ReturnType<typeof page>>>) {
    const calls: string[] = [];
    const counts: Record<string, number> = {};
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const owner = url.searchParams.get("owner")!;
      calls.push(`${owner}@${url.searchParams.get("after")}`);
      counts[owner] = (counts[owner] ?? 0) + 1;
      const own = pages[owner]!;
      return Response.json(own[Math.min(counts[owner] - 1, own.length - 1)]);
    });
    return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
  }

  it("polls each owner from its own position and yields one cursor over all", async () => {
    const r = owners({
      a: [page([ev("a1", 1)], "a-c1")],
      b: [{ ...page([ev("b1", 2)], "b-c1"), gap: true }],
    });
    const after = encodeCursor({
      sk: "1",
      seen: [],
      owners: { a: { sk: "10", seen: [] }, b: { sk: "20", seen: [] } },
    });
    const batches = await take(
      pollEvents({ ...conn, owner: ["A", "b", "a"], fetch: r.fetch, sleep: parked, after }),
      2,
    );
    expect(r.calls.toSorted()).toEqual(["a@10", "b@20"]);
    const byOwner = Object.fromEntries(batches.map((b) => [b.owner, b]));
    expect(byOwner["a"]).toMatchObject({ events: [{ id: "a1" }], gap: false });
    expect(byOwner["b"]).toMatchObject({ events: [{ id: "b1" }], gap: true });
    const last = batches[1] as Extract<EventsBatch, { cursor: string }>;
    expect(decodeCursor(last.cursor).owners).toEqual({
      a: { sk: "a-c1", seen: ["a1"] },
      b: { sk: "b-c1", seen: ["b1"] },
    });
  });

  it("starts every owner from since without a cursor, and needs at least one owner", async () => {
    const r = owners({ a: [page([])], b: [page([])] });
    await take(
      pollEvents({ ...conn, owner: ["a", "b"], fetch: r.fetch, sleep: parked, since: new Date(9) }),
      2,
    );
    expect(r.calls.toSorted()).toEqual(["a@9", "b@9"]);
    await expect(pollEvents({ ...conn, owner: [] }).next()).rejects.toThrow("owner is required");
  });

  it("throws a 400 instead of retrying it, stopping the other owners", async () => {
    const r = relay([() => Response.json({ error: "invalid filters" }, { status: 400 })]);
    const signal = new AbortController().signal;
    const source = pollEvents({ ...conn, owner: ["a", "b"], fetch: r.fetch, signal });
    await expect(source.next()).rejects.toBeInstanceOf(BadRequestError);
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

  it("throws for a cleartext URL before polling", async () => {
    const r = relay([() => Response.json(page([]))]);
    const source = pollPages({ ...conn, url: "http://relay.example", fetch: r.fetch, after: "0" });
    await expect(source.next()).rejects.toBeInstanceOf(TypeError);
    expect(r.afters).toHaveLength(0);
  });

  it("ends without an error when the signal aborts mid-request", async () => {
    const controller = new AbortController();
    const fetch = (async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof globalThis.fetch;
    const source = pollPages({ ...conn, fetch, signal: controller.signal, after: "0" });
    expect(await source.next()).toEqual({ done: true, value: undefined });
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
