import { describe, expect, it } from "vitest";

import { tail } from "../commands/tail.ts";
import { wait } from "../commands/wait.ts";
import { harness } from "../test-helpers/ctx.ts";
import { ev } from "../test-helpers/watch.ts";
import { encodeCursor } from "./cursor.ts";

const frame = (id: string, sk: string, over = {}) =>
  `id: ${encodeCursor({ sk, seen: [id] })}\nevent: envelope\ndata: ${JSON.stringify(ev(id, 1, over))}\n\n`;

/** A streaming Response whose body yields each chunk then closes. */
const sse = (...chunks: string[]): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );

type Reply = Response | Error;

async function sourced(replies: Reply[], onLast?: () => void) {
  const h = await harness();
  Object.assign(h.ctx.env, { HOOK_HARNESS_STATE_DIR: `${h.dir}/state` });
  const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
  h.ctx.fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), headers: init?.headers as Record<string, string> });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (calls.length >= replies.length) onLast?.();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { h, calls };
}

describe("wait/tail --source", () => {
  it("wait reads a serve stream with the same output contract, needing no relay login", async () => {
    const { h, calls } = await sourced([
      sse(": connected\n\n", frame("a", "s1"), frame("x", "s1", { event: "push" })),
    ]);
    const args = ["--source", "http://127.0.0.1:7391", "--event", "pull_request", "--repo", "o/r"];
    expect(await wait([...args, "--settle", "0s"], h.ctx)).toBe(0);
    const result = JSON.parse(h.out[0]!) as { events: Array<{ id: string }>; cursor: string };
    expect(result.events.map((event) => event.id)).toEqual(["a"]);
    expect(Object.keys(JSON.parse(h.out[0]!))).toEqual(["events", "gap", "cursor"]);
    expect(calls[0]!.url.pathname).toBe("/events");
    expect(calls[0]!.url.searchParams.getAll("filter").map((f) => JSON.parse(f))).toEqual([
      { repo: ["o/r"], event: ["pull_request"] },
    ]);
    expect(calls[0]!.headers.accept).toBe("text/event-stream");
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(JSON.parse(Buffer.from(result.cursor, "base64url").toString())).toMatchObject({
      sk: "s1",
      seen: ["a"],
    });
  });

  it("tail prints NDJSON, reports gaps and retries a dropped stream from the last id", async () => {
    const gapId = encodeCursor({ sk: "g1", seen: [] });
    const { h, calls } = await sourced(
      [
        sse(frame("a", "s1").slice(0, 20), frame("a", "s1").slice(20), ": ping\n\n"),
        sse(
          `event: gap\ndata: ${JSON.stringify({ cursor: gapId })}\n\n`,
          "event: other\ndata: 1\n\n",
          'id: not-a-cursor\nevent: envelope\ndata: {"id":"z"}\n\n',
        ),
        new Error("refused"),
        new Response("busy", { status: 503 }),
        sse(frame("b", "s2")),
      ],
      () => queueMicrotask(() => h.abort()),
    );
    h.ctx.env.HOOK_HARNESS_SOURCE = "http://localhost:7391/base";
    h.ctx.env.HOOK_HARNESS_SOURCE_TOKEN = "tok";
    expect(await tail([], h.ctx)).toBe(0);
    const lines = h.out.map((line) => JSON.parse(line));
    expect(lines.map((line) => line.event?.id ?? "gap")).toEqual(["a", "gap", "z", "b"]);
    expect(h.err).toEqual([
      "warning: serve closed the stream; retrying",
      "warning: serve closed the stream; retrying",
      "warning: refused; retrying",
      "warning: serve returned HTTP 503; retrying",
    ]);
    expect(calls[0]!.url.pathname).toBe("/base/events");
    expect(calls[0]!.headers.authorization).toBe("Bearer tok");
    expect(calls[1]!.headers["last-event-id"]).toBe(encodeCursor({ sk: "s1", seen: ["a"] }));
    expect(calls[2]!.headers["last-event-id"]).toBe(gapId);
  });

  it("fails fast on 401 and rejects bad source URLs", async () => {
    const { h } = await sourced([new Response("no", { status: 401 })]);
    await expect(wait(["--source", "http://x"], h.ctx)).rejects.toThrow("serve rejected the token");
    await expect(wait(["--source", "ftp://x"], h.ctx)).rejects.toThrow("invalid --source");
    await expect(wait(["--source", "nonsense"], h.ctx)).rejects.toThrow("invalid --source");
    await expect(wait(["--source", "http://x/"], h.ctx)).rejects.toThrow("serve rejected");
  });

  it("returns quietly when interrupted", async () => {
    const { h } = await sourced([new Error("down")]);
    h.ctx.fetch = async () => {
      h.abort();
      throw new Error("aborted fetch");
    };
    expect(await tail(["--source", "http://x"], h.ctx)).toBe(0);
    expect(h.err).toEqual([]);
  });
});
