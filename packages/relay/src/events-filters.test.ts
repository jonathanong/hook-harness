import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { MAX_FILTERS } from "./events-query.ts";
import { MAX_SCAN, SKIP_OVERLAP } from "./events.ts";
import { route } from "./handler.ts";
import { ddb, deps, NOW, request } from "./test-helpers/deps.ts";

// A fake table that honours `SK > :lower`, `Limit` and `ExclusiveStartKey`, so paging is real.
let table: { SK: string; repo: string; envelope: string }[] = [];
let read = 0;
const pad = (ms: number) => String(ms).padStart(15, "0");
const id = (i: number) => `e${String(i).padStart(5, "0")}`;

function seed(times: number[], event: (i: number) => string = () => "push") {
  table = times.map((ms, i) => ({
    SK: `${pad(ms)}#${id(i)}`,
    repo: "o/r",
    envelope: JSON.stringify({ v: 1, id: id(i), event: event(i), prs: [] }),
  }));
}

beforeEach(() => {
  read = 0;
  ddb.reset();
  ddb.on(GetCommand).resolves({ Item: { repos: ["o/r"], expiresAt: NOW / 1000 + 100 } });
  ddb.on(QueryCommand).callsFake((input) => {
    const lower = input.ExpressionAttributeValues[":lower"] as string;
    const start = (input.ExclusiveStartKey?.["SK"] as string | undefined) ?? lower;
    const rows = table.filter((row) => row.SK > start).slice(0, input.Limit as number);
    read += rows.length;
    const more = rows.length > 0 && table.some((row) => row.SK > rows.at(-1)!.SK);
    return { Items: rows, LastEvaluatedKey: more ? { SK: rows.at(-1)!.SK } : undefined };
  });
});

async function call(after: string, filters: string | undefined) {
  const event = request("GET", "/events", {
    headers: { authorization: "Bearer t" },
    queryStringParameters: { owner: "o", after, payload: "0", ...(filters ? { filters } : {}) },
  });
  return route(event, deps);
}

async function page(after: string, filters?: unknown) {
  const result = await call(after, filters === undefined ? undefined : JSON.stringify(filters));
  return JSON.parse(result.body!) as { events: { id: string }[]; cursor: string; more: boolean };
}

describe("GET /events filters", () => {
  it("returns only events matching any filter", async () => {
    seed([NOW - 3_000, NOW - 2_000, NOW - 1_000], (i) => (i === 1 ? "pull_request" : "push"));
    const result = await page(String(NOW - 10_000), [{ event: "pull_request" }, { event: "x" }]);
    expect(result.events.map((e) => e.id)).toEqual([id(1)]);
    expect(result.cursor).toBe(table[2]!.SK);
    expect(result.more).toBe(false);
  });

  it("does not filter on an empty list or unknown fields", async () => {
    seed([NOW - 2_000, NOW - 1_000]);
    expect((await page(String(NOW - 10_000), [])).events).toHaveLength(2);
    expect((await page(String(NOW - 10_000), [{ future: "x" }])).events).toHaveLength(2);
    expect((await call(String(NOW - 10_000), "")).statusCode).toBe(200);
  });

  it("rejects malformed filters", async () => {
    const tooMany = JSON.stringify(Array.from({ length: MAX_FILTERS + 1 }, () => ({})));
    for (const bad of ["{", '{"event":"push"}', "[1]", "[null]", "[[]]", tooMany]) {
      expect((await call(String(NOW), bad)).statusCode).toBe(400);
    }
  });

  it("caps the scan and moves the cursor forward until the data runs out", async () => {
    const total = MAX_SCAN * 2 + 500;
    seed(
      Array.from({ length: total }, (_, i) => NOW - 3_600_000 + i * 10),
      (i) => (i === total - 1 ? "pull_request" : "push"),
    );
    let cursor = String(NOW - 4_000_000);
    const cursors: string[] = [];
    const found: string[] = [];
    let more = true;
    while (more) {
      const before = read;
      const result = await page(cursor, [{ event: "pull_request" }]);
      expect(read - before).toBeLessThanOrEqual(MAX_SCAN);
      found.push(...result.events.map((e) => e.id));
      cursors.push(result.cursor);
      ({ cursor, more } = result);
    }
    expect(cursors).toEqual([
      `${table[MAX_SCAN - 1]!.SK}${SKIP_OVERLAP}`,
      `${table[MAX_SCAN * 2 - 1]!.SK}${SKIP_OVERLAP}`,
      table[total - 1]!.SK,
    ]);
    expect(found).toEqual([id(total - 1)]);
  });

  it("gets out of an overlap window holding more than the scan cap", async () => {
    const total = MAX_SCAN + 500;
    seed(Array.from({ length: total }, (_, i) => NOW - 50_000 + i));
    const first = await page(table[total - 1]!.SK, [{ event: "none" }]);
    expect(first).toEqual({
      events: [],
      cursor: `${table[MAX_SCAN - 1]!.SK}${SKIP_OVERLAP}`,
      gap: false,
      more: true,
    });
    const next = await page(first.cursor, [{ event: "none" }]);
    expect(next.cursor).toBe(table[total - 1]!.SK);
    expect(next.more).toBe(false);
  });
});
