import { afterEach, describe, expect, it } from "vitest";

import { jsonOf, mcpHarness, textOf } from "../test-helpers/mcp.ts";
import { ev, page } from "../test-helpers/watch.ts";
import { decodeCursor } from "../watch/cursor.ts";

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

const steps = () => ({
  a: [page([ev("a1", 1, { owner: "a" })], "sa")],
  b: [page([ev("b1", 2, { owner: "b" })], "sb", true)],
});

describe("several owners over MCP", () => {
  it("get_events polls each owner once and returns one cursor", async () => {
    const h = await start(steps());
    const body = jsonOf(await h.call("get_events", { owner: "a, b" }));
    expect((body.events as Array<{ id: string }>).map((event) => event.id).sort()).toEqual([
      "a1",
      "b1",
    ]);
    expect(body.gap).toBe(true);
    const polled = h.calls.urls.map((url) => url.searchParams.get("owner"));
    expect(new Set(polled)).toEqual(new Set(["a", "b"]));
    expect(Object.keys(decodeCursor(body.cursor as string).owners!).sort()).toEqual(["a", "b"]);
  });

  it("get_events takes one page per owner even when the relay has more", async () => {
    const h = await start({
      a: [{ ...page([ev("a1", 1, { owner: "a" })], "sa"), more: true }, page([ev("a2", 2)], "s2")],
      b: [page([ev("b1", 2, { owner: "b" })], "sb")],
    });
    const body = jsonOf(await h.call("get_events", { owner: "a,b" }));
    expect((body.events as Array<{ id: string }>).map((event) => event.id).sort()).toEqual([
      "a1",
      "b1",
    ]);
    expect(h.calls.urls).toHaveLength(2);
  });

  it("wait_for_events collects from every owner", async () => {
    const h = await start({ a: steps().a, b: [page([ev("b1", 2, { owner: "b" })], "sb")] });
    const body = jsonOf(await h.call("wait_for_events", { owner: "a,b" }));
    expect((body.events as Array<{ id: string }>).map((event) => event.id)).toEqual(["a1", "b1"]);
  });

  it("get_events fails when one owner fails", async () => {
    const h = await start({ a: steps().a, b: [new Error("offline")] });
    const result = await h.call("get_events", { owner: "a,b" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("b: offline");
  });
});
