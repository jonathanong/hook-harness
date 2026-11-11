import { describe, expect, it } from "vitest";

import { lastLine, page, watchHarness, ev } from "../test-helpers/watch.ts";
import { relayFilters } from "../watch/source.ts";
import { tail } from "./tail.ts";
import { wait } from "./wait.ts";

describe("relay-side filters", () => {
  it("sends the built filters so the relay can drop non-matching events", async () => {
    const h = await watchHarness([page([ev("a", 1, { event: "push" })])]);
    await wait(["--owner", "o", "--event", "push", "--on", "ejection", "--settle", "0s"], h.ctx);
    const sent = JSON.parse(h.calls.urls[0]!.searchParams.get("filters")!) as unknown[];
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ event: ["push"] });
    expect(lastLine(h).events).toMatchObject([{ id: "a" }]);
  });

  it("sends no filters param without filters", async () => {
    const h = await watchHarness([page([ev("a", 1)])]);
    await wait(["--owner", "o", "--settle", "0s"], h.ctx);
    expect(h.calls.urls[0]!.searchParams.has("filters")).toBe(false);
  });

  it("keeps filters local when there are too many or they are too long to send", () => {
    expect(relayFilters(undefined)).toBeUndefined();
    expect(relayFilters([])).toBeUndefined();
    expect(relayFilters(Array.from({ length: 51 }, () => ({})))).toBeUndefined();
    expect(relayFilters([{ event: "x".repeat(5000) }])).toBeUndefined();
    expect(relayFilters([{ event: "push" }])).toBe('[{"event":"push"}]');
  });

  it("polls again right away when the relay says there is more", async () => {
    const h = await watchHarness([
      { ...page([], "sk1"), more: true },
      () => {
        h.abort();
        return page([], "sk2");
      },
    ]);
    await tail(["--owner", "o"], h.ctx);
    expect(h.calls.times[1]).toBe(h.calls.times[0]);
    expect(h.calls.urls[1]!.searchParams.get("after")).toBe("sk1");
  });
});
