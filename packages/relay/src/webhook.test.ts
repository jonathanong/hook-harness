import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { route } from "./handler.ts";
import { unpackPayload } from "./payload.ts";
import { ddb, deps, NOW, request, webhookEvent } from "./test-helpers/deps.ts";
import { fixture } from "./test-helpers/fixture.ts";

beforeEach(() => {
  ddb.reset();
  ddb.on(PutCommand).resolves({});
});

describe("POST /webhook", () => {
  it("stores a normalized event with a TTL", async () => {
    const result = await route(
      webhookEvent("pull_request", fixture("pull_request.dequeued")),
      deps,
    );
    expect(result).toEqual({ statusCode: 202 });
    const [call] = ddb.commandCalls(PutCommand);
    const input = call!.args[0].input;
    expect(input.ConditionExpression).toBeUndefined();
    expect(input.Item).toMatchObject({
      PK: "owner#o",
      repo: "o/r",
      SK: `${String(NOW).padStart(15, "0")}#d-1`,
      expiresAt: Math.floor(NOW / 1000) + 86400,
    });
    const envelope = JSON.parse(input.Item!["envelope"]);
    expect(envelope).toMatchObject({
      id: "d-1",
      receivedAt: "2026-11-09T12:00:00.000Z",
      prs: [42],
    });
    const stored = unpackPayload(input.Item!["payload"]);
    expect(stored).toMatchObject({ action: "dequeued" });
    expect(stored).not.toHaveProperty("repository");
    expect(stored).not.toHaveProperty("installation");
  });

  it("stores only the envelope when payloads are disabled", async () => {
    const off = { ...deps, payload: { drop: [], maxBytes: 0 } };
    await route(webhookEvent("push", fixture("push")), off);
    const item = ddb.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item).toMatchObject({ payloadOmitted: "disabled" });
    expect(item).not.toHaveProperty("payload");
  });

  it("verifies the signature over decoded base64 bytes", async () => {
    const event = webhookEvent("push", fixture("push"), { base64: true });
    expect((await route(event, deps)).statusCode).toBe(202);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(1);
  });

  it("rejects bad, wrong-length, missing signatures and a missing secret", async () => {
    const payload = fixture("push");
    const bad = webhookEvent("push", payload, { signature: `sha256=${"0".repeat(64)}` });
    const short = webhookEvent("push", payload, { signature: "sha256=00" });
    const missing = webhookEvent("push", payload, {
      headers: { "x-hub-signature-256": undefined },
    });
    for (const event of [bad, short, missing]) {
      expect((await route(event, deps)).statusCode).toBe(401);
    }
    expect(
      (await route(webhookEvent("push", payload), { ...deps, secret: undefined })).statusCode,
    ).toBe(401);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("rejects a request with no body", async () => {
    const event = request("POST", "/webhook", { headers: { "x-hub-signature-256": "sha256=00" } });
    expect((await route(event, deps)).statusCode).toBe(401);
  });

  it("answers ping without writing", async () => {
    expect((await route(webhookEvent("ping", { zen: "x" }), deps)).statusCode).toBe(200);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("rejects missing event or delivery headers", async () => {
    const event = webhookEvent("push", fixture("push"), {
      headers: { "x-github-delivery": undefined },
    });
    expect((await route(event, deps)).statusCode).toBe(400);
  });

  it("drops events outside the allowlist and uninteresting actions", async () => {
    expect((await route(webhookEvent("fork", {}), deps)).statusCode).toBe(202);
    const labeled = fixture("pull_request.dequeued", (p) => (p.action = "labeled"));
    expect((await route(webhookEvent("pull_request", labeled), deps)).statusCode).toBe(202);
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("returns a generic 500 for other failures", async () => {
    ddb.on(PutCommand).rejects(new Error("secret internal detail"));
    const result = await route(webhookEvent("push", fixture("push")), deps);
    expect(result).toEqual({
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: '{"error":"internal error"}',
    });
  });
});

describe("routing", () => {
  it("returns 404 for unknown routes and methods", async () => {
    expect((await route(request("GET", "/nope"), deps)).statusCode).toBe(404);
    expect((await route(request("GET", "/webhook"), deps)).statusCode).toBe(404);
    expect((await route(request("POST", "/events"), deps)).statusCode).toBe(404);
  });
});
