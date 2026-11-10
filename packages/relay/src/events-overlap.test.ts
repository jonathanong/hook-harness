import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { RESPONSE_BUDGET, SKIP_OVERLAP } from "./events.ts";
import { route } from "./handler.ts";
import { ddb, deps, NOW, request } from "./test-helpers/deps.ts";

// A fake table that honours `SK > :lower`, `Limit` and `ExclusiveStartKey`, so paging is real.
let table: { SK: string; repo: string; envelope: string }[] = [];
const pad = (ms: number) => String(ms).padStart(15, "0");
const id = (i: number) => `e${String(i).padStart(4, "0")}`;

function seed(times: number[], envelope: (i: number) => object = (i) => ({ v: 1, id: id(i) })) {
  table = times.map((ms, i) => ({
    SK: `${pad(ms)}#${id(i)}`,
    repo: "o/r",
    envelope: JSON.stringify(envelope(i)),
  }));
}

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand).resolves({ Item: { repos: ["o/r"], expiresAt: NOW / 1000 + 100 } });
  ddb.on(QueryCommand).callsFake((input) => {
    const lower = input.ExpressionAttributeValues[":lower"] as string;
    const start = (input.ExclusiveStartKey?.["SK"] as string | undefined) ?? lower;
    const rows = table.filter((row) => row.SK > start).slice(0, input.Limit as number);
    const more = rows.length > 0 && table.some((row) => row.SK > rows.at(-1)!.SK);
    return { Items: rows, LastEvaluatedKey: more ? { SK: rows.at(-1)!.SK } : undefined };
  });
});

async function page(after: string, limit = "100") {
  const event = request("GET", "/events", {
    headers: { authorization: "Bearer t" },
    queryStringParameters: { owner: "o", after, limit, payload: "0" },
  });
  return JSON.parse((await route(event, deps)).body!) as {
    events: { id: string }[];
    cursor: string;
  };
}

describe("GET /events overlap replay", () => {
  it("gets past a burst larger than the limit inside the overlap", async () => {
    // 150 events inside 30s, then 5 more a minute later; the caller has seen the first 100.
    const base = NOW - 3_600_000;
    seed([
      ...Array.from({ length: 150 }, (_, i) => base + i * 200),
      ...Array.from({ length: 5 }, (_, i) => base + 90_000 + i),
    ]);
    const first = await page(table[99]!.SK);
    const ids = first.events.map((e) => e.id);
    // The replayed overlap comes back, but the remaining 55 events fit in the same response.
    expect(ids).toEqual(Array.from({ length: 155 }, (_, i) => id(i)));
    expect(first.cursor).toBe(table.at(-1)!.SK);
    // Without the fix the cursor came back as the 100th event and never moved.
    expect((await page(first.cursor)).events.map((e) => e.id)).toEqual(ids.slice(-5));
  });

  it("still fills on events past the cursor, resuming after the last one", async () => {
    seed(Array.from({ length: 30 }, (_, i) => NOW - 10_000 + i));
    const result = await page(table[9]!.SK, "5");
    expect(result.events).toHaveLength(15);
    expect(result.cursor).toBe(table[14]!.SK);
  });

  it("skips the overlap on the next read when the size budget runs out inside it", async () => {
    const big = "x".repeat(RESPONSE_BUDGET / 2);
    seed(
      Array.from({ length: 4 }, (_, i) => NOW - 10_000 + i),
      (i) => ({ v: 1, id: id(i), pad: big }),
    );
    const first = await page(table[3]!.SK);
    expect(first.events.map((e) => e.id)).toEqual([id(0)]);
    expect(first.cursor).toBe(`${table[3]!.SK}${SKIP_OVERLAP}`);
    table.push({ SK: `${pad(NOW - 1)}#${id(9)}`, repo: "o/r", envelope: '{"v":1,"id":"e0009"}' });
    const next = await page(first.cursor);
    expect(next.events.map((e) => e.id)).toEqual([id(9)]);
    expect(next.cursor).toBe(table.at(-1)!.SK);
  });

  it("accepts a bare start time with the skip marker and rejects other suffixes", async () => {
    seed([NOW - 5_000, NOW - 1_000]);
    expect((await page(`${NOW - 5_000}${SKIP_OVERLAP}`)).events).toHaveLength(2);
    expect((await page(`${NOW - 3_000}${SKIP_OVERLAP}`)).events.map((e) => e.id)).toEqual([id(1)]);
    const bad = request("GET", "/events", {
      headers: { authorization: "Bearer t" },
      queryStringParameters: { owner: "o", after: "123!x" },
    });
    expect((await route(bad, deps)).statusCode).toBe(400);
  });

  it("replays the overlap for a skip cursor older than retention", async () => {
    seed([NOW - 86_000_000]);
    const result = await page(`${pad(NOW - 90_000_000)}#x${SKIP_OVERLAP}`);
    expect(result.events).toHaveLength(1);
  });
});
