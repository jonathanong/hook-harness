import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handler } from "./index.ts";
import {
  eventExpiresAt,
  eventPk,
  eventSk,
  padMs,
  tokenAllowsOwner,
  tokenAllowsRepo,
  tokenHash,
  tokenKey,
} from "./keys.ts";
import { ddb, sign, webhookEvent } from "./test-helpers/deps.ts";
import { fixture } from "./test-helpers/fixture.ts";

describe("keys", () => {
  it("formats keys", () => {
    expect(padMs(5)).toBe("000000000000005");
    expect(eventPk("Octo")).toBe("owner#octo");
    expect(eventSk(1_700_000_000_123, "d")).toBe("001700000000123#d");
    expect(eventExpiresAt(1_700_000_000_999)).toBe(1_700_086_400);
  });

  it("hashes tokens with sha256", () => {
    expect(tokenHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(tokenKey("abc")).toEqual({ PK: `token#${tokenHash("abc")}`, SK: "token" });
  });
});

describe("token scopes", () => {
  it("matches repos, owner wildcards and *", () => {
    expect(tokenAllowsRepo(["o/r"], "O/R")).toBe(true);
    expect(tokenAllowsRepo(["o/*"], "o/x")).toBe(true);
    expect(tokenAllowsRepo(["*"], "z/x")).toBe(true);
    expect(tokenAllowsRepo(["o/r"], "o/x")).toBe(false);
    expect(tokenAllowsRepo(["p/*"], "o/x")).toBe(false);
    expect(tokenAllowsOwner(["o/r"], "O")).toBe(true);
    expect(tokenAllowsOwner(["*"], "z")).toBe(true);
    expect(tokenAllowsOwner(["o/r"], "z")).toBe(false);
  });
});

describe("signature", () => {
  it("signs raw bytes", () => {
    expect(sign(Buffer.from("x"))).toBe(sign("x"));
  });
});

describe("handler", () => {
  beforeEach(() => {
    ddb.reset();
    ddb.on(PutCommand).resolves({});
    vi.stubEnv("TABLE_NAME", "T");
    vi.stubEnv("WEBHOOK_SECRET", "s3cret");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("wires the environment into the router", async () => {
    const result = await handler(webhookEvent("push", fixture("push")));
    expect(result.statusCode).toBe(202);
    expect(ddb.commandCalls(PutCommand)[0]!.args[0].input.TableName).toBe("T");
  });
});
