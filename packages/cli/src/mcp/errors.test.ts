import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonOf, mcpHarness, textOf } from "../test-helpers/mcp.ts";
import { ev, page } from "../test-helpers/watch.ts";
import { waitForEvents, type Extra } from "./tools.ts";

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

async function start(steps: Parameters<typeof mcpHarness>[0]) {
  const h = await mcpHarness(steps);
  closer = h.close;
  return h;
}

describe("error mapping", () => {
  it.each([401, 403])("maps HTTP %i to a tool error naming hook-harness login", async (status) => {
    const h = await start([new Response("no", { status })]);
    for (const tool of ["wait_for_events", "get_events"]) {
      const result = await h.call(tool, { owner: "o" });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("hook-harness login");
    }
  });

  it("maps a missing login to a tool error", async () => {
    const h = await start([page([])]);
    delete h.ctx.env.HOOK_HARNESS_TOKEN;
    h.ctx.env.HOOK_HARNESS_CONFIG_DIR = `${h.dir}/nowhere`;
    const result = await h.call("get_events", { owner: "o" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not logged in.*hook-harness login/);
  });

  it("maps an invalid cursor and an invalid since", async () => {
    const h = await start([page([])]);
    const cursor = await h.call("get_events", { owner: "o", after: "garbage" });
    expect(textOf(cursor)).toMatch(/invalid cursor/);
    const since = await h.call("wait_for_events", { owner: "o", since: "yesterday-ish" });
    expect(since.isError).toBe(true);
    expect(textOf(since)).toMatch(/invalid --since/);
  });

  it("maps a relay failure on a single poll", async () => {
    const h = await start([new Response("", { status: 500 })]);
    const result = await h.call("get_events", { owner: "o" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("HTTP 500");
  });

  it("maps a relay that stays down until the timeout", async () => {
    const h = await start([new Error("ECONNREFUSED")]);
    const result = await h.call("wait_for_events", { owner: "o", timeout_seconds: 20 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("ECONNREFUSED");
  });

  it("maps a thrown non-Error", async () => {
    const h = await start([page([])]);
    h.ctx.fetch = () => Promise.reject("boom");
    const result = await h.call("get_events", { owner: "o" });
    expect(textOf(result)).toContain("boom");
  });

  it("rejects out-of-range timeouts and unknown filter keys", async () => {
    const h = await start([page([])]);
    const bad = [
      { owner: "o", timeout_seconds: 601 },
      { owner: "o", filters: [{ evnt: "push" }] },
      {},
    ];
    for (const args of bad) {
      const outcome = await h.call("wait_for_events", args).then(
        (result) => result.isError === true,
        () => true,
      );
      expect(outcome).toBe(true);
    }
    expect(h.calls.urls).toHaveLength(0);
  });
});

describe("cancellation", () => {
  it("aborts the poll when the client cancels the request", async () => {
    const h = await start([page([])]);
    let seen: AbortSignal | undefined;
    h.ctx.fetch = async (_url, init) => {
      seen = init?.signal ?? undefined;
      return Response.json(page([]));
    };
    h.ctx.sleep = (_ms, signal) =>
      new Promise((resolve) => signal.addEventListener("abort", () => resolve()));
    const controller = new AbortController();
    const pending = h.client.callTool(
      { name: "wait_for_events", arguments: { owner: "o" } },
      undefined,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(seen).toBeDefined());
    controller.abort();
    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(seen!.aborted).toBe(true));
  });

  it("returns a cancelled error when the process signal aborts first", async () => {
    const h = await start([page([])]);
    h.abort();
    for (const tool of ["wait_for_events", "get_events"]) {
      const result = await h.call(tool, { owner: "o" });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/cancelled/);
    }
  });
});

describe("progress", () => {
  it("sends notifications/progress while blocked when the client asks", async () => {
    const h = await start([page([], "s")]);
    const progress: Array<{ progress: number; total?: number | undefined }> = [];
    const result = await h.client.callTool(
      { name: "wait_for_events", arguments: { owner: "o", timeout_seconds: 30 } },
      undefined,
      { onprogress: (p) => progress.push(p) },
    );
    expect(jsonOf(result as never)).toMatchObject({ timedOut: true });
    expect(progress.map((p) => p.progress)).toEqual([0, 15_000, 30_000]);
    expect(progress.every((p) => p.total === 30_000)).toBe(true);
  });

  it("keeps progress strictly increasing and survives a failing notification", async () => {
    const h = await start([page([])]);
    const sent: number[] = [];
    const extra = {
      signal: new AbortController().signal,
      _meta: { progressToken: "t" },
      sendNotification: (n: { params: { progress: number } }) => {
        sent.push(n.params.progress);
        return Promise.reject(new Error("transport closed"));
      },
    } as unknown as Extra;
    const full = Array.from({ length: 100 }, (_, i) => ev(`e${i}`, i, { event: "push" }));
    let calls = 0;
    h.ctx.fetch = async () => Response.json(page(calls++ < 2 ? full : [], "s"));
    const input = {
      owner: "o",
      filters: [{ event: "pull_request" }],
      include_payload: true,
      timeout_seconds: 1,
      settle_seconds: 0,
    };
    const result = await waitForEvents(input, h.ctx, extra);
    expect(result.isError).toBeUndefined();
    expect(sent.length).toBeGreaterThan(1);
    expect(new Set(sent).size).toBe(sent.length);
    expect(sent).toEqual([...sent].sort((a, b) => a - b));
  });
});
