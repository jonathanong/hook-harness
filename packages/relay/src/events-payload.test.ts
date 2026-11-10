import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { RESPONSE_BUDGET } from "./events.ts";
import { route } from "./handler.ts";
import { packPayload } from "./payload.ts";
import { ddb, deps, NOW, request } from "./test-helpers/deps.ts";
import type { UrlEvent } from "./types.ts";

const sk = (ms: number) => `${String(ms).padStart(15, "0")}#d`;
const item = (ms: number, id: string) => ({
  SK: sk(ms),
  repo: "o/r",
  envelope: JSON.stringify({ v: 1, id }),
});
const get = (query: Record<string, string>): UrlEvent =>
  request("GET", "/events", {
    headers: { authorization: "Bearer t" },
    queryStringParameters: query,
  });
const query = () => ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
const bodyOf = async (event: UrlEvent) => JSON.parse((await route(event, deps)).body!);

beforeEach(() => {
  ddb.reset();
  ddb.on(GetCommand).resolves({
    Item: { repos: ["o/r"], expiresAt: NOW / 1000 + 100, revoked: false },
  });
});

describe("GET /events payloads", () => {
  const withPayload = (ms: number, id: string, payload: Record<string, unknown>) => ({
    ...item(ms, id),
    ...packPayload(payload, { drop: [], maxBytes: 10_000_000 }),
  });

  it("inflates stored payloads and passes through omission reasons", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        withPayload(1, "a", { action: "x" }),
        { ...item(2, "b"), payloadOmitted: "too_large" },
      ],
    });
    expect((await bodyOf(get({ owner: "o" }))).events).toEqual([
      { v: 1, id: "a", payload: { action: "x" } },
      { v: 1, id: "b", payloadOmitted: "too_large" },
    ]);
  });

  it("skips payloads when payload=0", async () => {
    ddb.on(QueryCommand).resolves({ Items: [withPayload(1, "a", { action: "x" })] });
    expect((await bodyOf(get({ owner: "o", payload: "0" }))).events).toEqual([
      { v: 1, id: "a", payloadOmitted: "not_requested" },
    ]);
  });

  it("stops filling a page at the response budget", async () => {
    const big = { blob: "x".repeat(RESPONSE_BUDGET / 2) };
    ddb.on(QueryCommand).resolvesOnce({
      Items: [withPayload(1, "a", big), withPayload(2, "b", big), withPayload(3, "c", big)],
      LastEvaluatedKey: { k: 1 },
    });
    const body = await bodyOf(get({ owner: "o" }));
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(["a"]);
    expect(body.cursor).toBe(sk(1));
    expect(query()).toHaveLength(1);
  });
});
