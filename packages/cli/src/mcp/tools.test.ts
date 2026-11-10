import { afterEach, describe, expect, it } from "vitest";

import { jsonOf, mcpHarness, START, textOf } from "../test-helpers/mcp.ts";
import { ev, page } from "../test-helpers/watch.ts";
import { decodeCursor, encodeCursor } from "../watch/cursor.ts";
import { readCursor } from "../watch/store.ts";

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

describe("tool listing", () => {
  it("advertises three tools with agent-facing descriptions", async () => {
    const h = await start([page([])]);
    const { tools } = await h.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "filter_help",
      "get_events",
      "wait_for_events",
    ]);
    const waitTool = tools.find((tool) => tool.name === "wait_for_events")!;
    expect(waitTool.description).toMatch(/pass the returned `cursor` back as `after`/i);
    expect(waitTool.description).toMatch(/gap:true .*GitHub API/);
    expect(waitTool.description).toMatch(/untrusted/);
    expect(waitTool.description).toMatch(/hook-harness login/);
    expect(waitTool.inputSchema.required).toEqual(["owner"]);
    expect(waitTool.outputSchema).toBeDefined();
  });

  it("filter_help documents fields and examples", async () => {
    const h = await start([page([])]);
    const text = textOf(await h.call("filter_help", {}));
    for (const needle of ["minAssociation", "dequeued", "workflow_run", "/shepherd", "OR'd"]) {
      expect(text).toContain(needle);
    }
    expect(h.calls.urls).toHaveLength(0);
  });
});

describe("wait_for_events", () => {
  it("returns text and structured content with the defaults", async () => {
    const h = await start([page([ev("a", 1)], "sk-a")]);
    const result = await h.call("wait_for_events", { owner: "o" });
    expect(result.isError).toBeUndefined();
    const body = jsonOf(result);
    expect(body).toMatchObject({ events: [{ id: "a" }], gap: false, timedOut: false });
    expect(result.structuredContent).toEqual(body);
    expect(decodeCursor(body.cursor as string)).toEqual({ sk: "sk-a", seen: ["a"] });

    const url = h.calls.urls[0]!;
    expect(url.searchParams.get("owner")).toBe("o");
    expect(url.searchParams.get("after")).toBe(String(START));
    expect(url.searchParams.has("payload")).toBe(false);
    expect(url.searchParams.has("repos")).toBe(false);
  });

  it("settles for 5s by default and settle_seconds overrides it", async () => {
    const h = await start([page([ev("a", 1)], "s1"), page([ev("b", 2)], "s2")]);
    const result = jsonOf(await h.call("wait_for_events", { owner: "o" }));
    expect(h.calls.times).toEqual([START, START + 5000]);
    expect(result.events).toHaveLength(2);

    const h2 = await start([page([ev("a", 1)], "s1"), page([ev("b", 2)], "s2")]);
    await h2.call("wait_for_events", { owner: "o", settle_seconds: 0 });
    expect(h2.calls.urls).toHaveLength(1);
  });

  it("times out after 240s by default with a fresh cursor", async () => {
    const h = await start([page([], "s-empty")]);
    const body = jsonOf(await h.call("wait_for_events", { owner: "o" }));
    expect(body).toMatchObject({ events: [], gap: false, timedOut: true });
    expect(decodeCursor(body.cursor as string).sk).toBe("s-empty");
    expect(h.calls.times.at(-1)).toBe(START + 240_000);
  });

  it("honours timeout_seconds", async () => {
    const h = await start([page([], "s")]);
    await h.call("wait_for_events", { owner: "o", timeout_seconds: 30 });
    expect(h.calls.times).toEqual([START, START + 15_000, START + 30_000]);
  });

  it("applies OR'd filters, repos, and include_payload=false", async () => {
    const h = await start([
      page([ev("a", 1, { event: "push" }), ev("b", 2), ev("c", 3, { command: "/plan" })], "s1"),
    ]);
    const body = jsonOf(
      await h.call("wait_for_events", {
        owner: "o",
        repos: ["o/r", "o/s"],
        filters: [{ event: "pull_request" }, { command: ["/plan"] }],
        include_payload: false,
        settle_seconds: 0,
      }),
    );
    expect((body.events as Array<{ id: string }>).map((e) => e.id)).toEqual(["b", "c"]);
    const url = h.calls.urls[0]!;
    expect(url.searchParams.get("repos")).toBe("o/r,o/s");
    expect(url.searchParams.get("payload")).toBe("0");
  });

  it("is stateless by default: resumes from after, never reads or writes state", async () => {
    const h = await start([page([ev("dup", 1), ev("new", 2)], "s2")]);
    const after = encodeCursor({ sk: "s1", seen: ["dup"] });
    const body = jsonOf(await h.call("wait_for_events", { owner: "o", after, settle_seconds: 0 }));
    expect(h.calls.urls[0]!.searchParams.get("after")).toBe("s1");
    expect(body.events).toMatchObject([{ id: "new" }]);
    expect(await readCursor(h.ctx.env, "default")).toBeUndefined();
  });

  it("starts from since (duration)", async () => {
    const h = await start([page([], "s")]);
    await h.call("wait_for_events", { owner: "o", since: "2h", timeout_seconds: 1 });
    expect(h.calls.urls[0]!.searchParams.get("after")).toBe(String(START - 7_200_000));
  });

  it("reports a gap immediately", async () => {
    const h = await start([page([], "s9", true)]);
    expect(jsonOf(await h.call("wait_for_events", { owner: "o" }))).toMatchObject({
      gap: true,
      timedOut: false,
    });
  });

  it("cursor_name opts in to the named state file", async () => {
    const h = await start([page([ev("a", 1)], "s1"), page([ev("b", 2)], "s2")]);
    const first = jsonOf(
      await h.call("wait_for_events", { owner: "o", cursor_name: "mcp", settle_seconds: 0 }),
    );
    expect(await readCursor(h.ctx.env, "mcp")).toBe(first.cursor);
    await h.call("wait_for_events", { owner: "o", cursor_name: "mcp", settle_seconds: 0 });
    expect(h.calls.urls[1]!.searchParams.get("after")).toBe("s1");
    expect(await readCursor(h.ctx.env, "default")).toBeUndefined();
  });
});

describe("get_events", () => {
  it("polls once without sleeping and returns the page", async () => {
    const h = await start([page([ev("a", 1), ev("b", 2, { event: "push" })], "s1", true)]);
    const result = await h.call("get_events", {
      owner: "o",
      filters: [{ event: "pull_request" }],
    });
    const body = jsonOf(result);
    expect(body).toMatchObject({ events: [{ id: "a" }], gap: true });
    expect(body).not.toHaveProperty("timedOut");
    expect(result.structuredContent).toEqual(body);
    expect(decodeCursor(body.cursor as string)).toEqual({ sk: "s1", seen: ["a", "b"] });
    expect(h.calls.urls).toHaveLength(1);
    expect(h.clock.ms).toBe(START);
  });

  it("returns all events with no filters and supports cursor_name", async () => {
    const h = await start([page([ev("a", 1)], "s1")]);
    const body = jsonOf(await h.call("get_events", { owner: "o", cursor_name: "g" }));
    expect(body.events).toHaveLength(1);
    expect(await readCursor(h.ctx.env, "g")).toBe(body.cursor);
  });
});
