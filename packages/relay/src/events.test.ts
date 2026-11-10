import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { route } from "./handler.ts";
import { tokenKey } from "./keys.ts";
import { ddb, deps, NOW, request } from "./test-helpers/deps.ts";
import type { UrlEvent } from "./types.ts";

const TOKEN = "tok-123";
const nowSeconds = NOW / 1000;
const pad = (ms: number) => String(ms).padStart(15, "0");
const sk = (ms: number) => `${pad(ms)}#d`;
const item = (ms: number, id: string, repo = "o/r") => ({
  SK: sk(ms),
  repo,
  envelope: JSON.stringify({ v: 1, id }),
});

function get(query: Record<string, string>, auth = `Bearer ${TOKEN}`): UrlEvent {
  return request("GET", "/events", {
    headers: { authorization: auth },
    queryStringParameters: query,
  });
}

function token(fields: Record<string, unknown> = {}) {
  ddb.on(GetCommand).resolves({
    Item: { repos: ["o/r"], expiresAt: nowSeconds + 100, revoked: false, ...fields },
  });
}

const query = () => ddb.commandCalls(QueryCommand).map((c) => c.args[0].input);
const bodyOf = async (event: UrlEvent) => JSON.parse((await route(event, deps)).body!);

beforeEach(() => {
  ddb.reset();
  token();
  ddb.on(QueryCommand).resolves({ Items: [] });
});

describe("GET /events auth", () => {
  it("looks the token up by its hash", async () => {
    await route(get({ owner: "o" }), deps);
    expect(ddb.commandCalls(GetCommand)[0]!.args[0].input.Key).toEqual(tokenKey(TOKEN));
  });

  it("rejects a missing or malformed header without a lookup", async () => {
    expect((await route(get({ owner: "o" }, ""), deps)).statusCode).toBe(401);
    expect((await route(get({ owner: "o" }, "Basic abc"), deps)).statusCode).toBe(401);
    expect(ddb.commandCalls(GetCommand)).toHaveLength(0);
  });

  it("rejects a request with no authorization header", async () => {
    const event = request("GET", "/events", { queryStringParameters: { owner: "o" } });
    expect((await route(event, deps)).statusCode).toBe(401);
  });

  it("rejects unknown, revoked and expired tokens", async () => {
    ddb.on(GetCommand).resolves({});
    expect((await route(get({ owner: "o" }), deps)).statusCode).toBe(401);
    token({ revoked: true });
    expect((await route(get({ owner: "o" }), deps)).statusCode).toBe(401);
    token({ expiresAt: nowSeconds - 1 });
    expect((await route(get({ owner: "o" }), deps)).statusCode).toBe(401);
    token({ expiresAt: undefined });
    expect((await route(get({ owner: "o" }), deps)).statusCode).toBe(401);
    expect(query()).toHaveLength(0);
  });

  it("requires an owner the token covers", async () => {
    expect((await route(get({}), deps)).statusCode).toBe(400);
    expect((await route(get({ owner: "x" }), deps)).statusCode).toBe(403);
    for (const repos of [["o/*"], ["*"], ["O/r"]]) {
      token({ repos });
      expect((await route(get({ owner: "o" }), deps)).statusCode).toBe(200);
    }
  });

  it("handles a request without query parameters", async () => {
    const event = request("GET", "/events", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect((await route(event, deps)).statusCode).toBe(400);
  });
});

describe("GET /events query", () => {
  it("queries the lower-cased owner partition from now minus one day", async () => {
    const lower = pad(NOW - 86_400_000);
    token({ repos: ["*"] });
    const body = await bodyOf(get({ owner: "Octo" }));
    expect(query()[0]).toMatchObject({
      KeyConditionExpression: "PK = :pk AND SK > :lower",
      ExpressionAttributeValues: { ":pk": "owner#octo", ":lower": lower },
      ScanIndexForward: true,
      Limit: 100,
    });
    expect(body).toEqual({ events: [], cursor: lower, gap: false });
  });

  it("subtracts 60s from a recent cursor and echoes it when empty", async () => {
    const after = sk(NOW - 1000);
    const body = await bodyOf(get({ owner: "o", after }));
    expect(query()[0]!.ExpressionAttributeValues![":lower"]).toBe(pad(NOW - 61_000));
    expect(body).toMatchObject({ cursor: after, gap: false });
  });

  it("clamps an old cursor to retention and flags a gap", async () => {
    const body = await bodyOf(get({ owner: "o", after: sk(NOW - 90_000_000) }));
    expect(query()[0]!.ExpressionAttributeValues![":lower"]).toBe(pad(NOW - 86_400_000));
    expect(body).toMatchObject({ gap: true });
  });

  it("rejects an invalid cursor", async () => {
    expect((await route(get({ owner: "o", after: "junk" }), deps)).statusCode).toBe(400);
  });

  it("clamps and defaults the limit", async () => {
    for (const limit of ["9999", "0", "abc", "7"]) await route(get({ owner: "o", limit }), deps);
    expect(query().map((q) => q.Limit)).toEqual([500, 100, 100, 7]);
  });

  it("follows LastEvaluatedKey until the limit is filled", async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [item(1, "a")], LastEvaluatedKey: { k: 1 } })
      .resolvesOnce({ Items: [item(2, "b"), item(3, "c")], LastEvaluatedKey: { k: 2 } });
    const body = await bodyOf(get({ owner: "o", limit: "2" }));
    expect(body).toEqual({
      events: [
        { v: 1, id: "a" },
        { v: 1, id: "b" },
      ],
      cursor: sk(2),
      gap: false,
    });
    expect(query().map((q) => q.ExclusiveStartKey)).toEqual([undefined, { k: 1 }]);
  });

  it("stops when the partition is exhausted", async () => {
    ddb.on(QueryCommand).resolves({});
    expect((await bodyOf(get({ owner: "o" }))).events).toEqual([]);
  });
});

describe("GET /events filtering", () => {
  const items = [item(1, "a", "o/r"), item(2, "b", "o/secret"), item(3, "c", "O/Other")];

  it("keeps only repos the token allows", async () => {
    ddb.on(QueryCommand).resolves({ Items: items });
    const body = await bodyOf(get({ owner: "o" }));
    expect(body.events).toEqual([{ v: 1, id: "a" }]);
    expect(body.cursor).toBe(sk(3));
  });

  it("applies the repos filter case-insensitively", async () => {
    token({ repos: ["o/*"] });
    ddb.on(QueryCommand).resolves({ Items: items });
    const body = await bodyOf(get({ owner: "o", repos: "o/Secret,o/other" }));
    expect(body.events.map((e: { id: string }) => e.id)).toEqual(["b", "c"]);
  });

  it("advances the cursor past filtered-out events", async () => {
    ddb.on(QueryCommand).resolves({ Items: [item(5, "x", "o/secret")] });
    expect(await bodyOf(get({ owner: "o" }))).toMatchObject({ events: [], cursor: sk(5) });
  });
});
