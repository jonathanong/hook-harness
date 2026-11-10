import { DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { sha256Hex } from "../aws/tokens.ts";
import { cfnMock, ddbMock, harness, stubStack } from "../test-helpers/ctx.ts";
import { parseExpiry, parseRepos, token } from "./token.ts";

beforeEach(() => {
  cfnMock.reset();
  ddbMock.reset();
  stubStack({ exists: true });
});

const item = (hash: string, extra: Record<string, unknown> = {}) => ({
  PK: `token#${hash}`,
  SK: "token",
  repos: ["a/b"],
  expiresAt: 1_800_000_000,
  revoked: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  label: "ci",
  ...extra,
});

describe("parsers", () => {
  it("parses expiry", () => {
    expect(parseExpiry("90d")).toBe(90 * 86400);
    expect(parseExpiry("2h")).toBe(7200);
    expect(parseExpiry("5m")).toBe(300);
    for (const bad of ["0d", "90", "d", "1w"]) expect(() => parseExpiry(bad)).toThrow("--expires");
  });

  it("parses repos", () => {
    expect(parseRepos(" a/b , c.d/e-f ")).toEqual(["a/b", "c.d/e-f"]);
    expect(parseRepos("a/b,*")).toEqual(["*"]);
    expect(() => parseRepos(undefined)).toThrow("--repos is required");
    expect(() => parseRepos("nope")).toThrow('invalid repo "nope"');
  });
});

describe("token create", () => {
  it("stores the hash only and prints the token once", async () => {
    ddbMock.on(PutCommand).resolves({});
    const h = await harness();
    expect(
      await token(["create", "--repos", "a/b,c/d", "--expires", "1d", "--label", "ci"], h.ctx),
    ).toBe(0);
    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input;
    const printed = h.out.find((line) => line.startsWith("Token (shown once): "))!.split(": ")[1]!;
    expect(printed).toBe(`hh_${Buffer.alloc(32, 1).toString("base64url")}`);
    expect(put.TableName).toBe("hook-harness-table");
    expect(put.Item).toEqual({
      PK: `token#${sha256Hex(printed)}`,
      SK: "token",
      repos: ["a/b", "c/d"],
      expiresAt: Math.floor(Date.parse("2026-11-09T00:00:00Z") / 1000) + 86400,
      revoked: false,
      createdAt: "2026-11-09T00:00:00.000Z",
      label: "ci",
    });
    expect(JSON.stringify(put)).not.toContain(printed);
  });

  it("defaults label and expiry", async () => {
    ddbMock.on(PutCommand).resolves({});
    const h = await harness();
    await token(["create", "--repos", "*"], h.ctx);
    const put = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(put.label).toBe("");
    expect(put.expiresAt).toBe(Math.floor(Date.parse("2026-11-09T00:00:00Z") / 1000) + 90 * 86400);
  });

  it("requires an existing stack with outputs", async () => {
    cfnMock.reset();
    stubStack({ exists: false });
    const h = await harness();
    await expect(token(["create", "--repos", "a/b"], h.ctx)).rejects.toThrow("does not exist");
    cfnMock.reset();
    stubStack({ exists: true, outputs: false });
    await expect(token(["create", "--repos", "a/b"], h.ctx)).rejects.toThrow(
      "missing output FunctionUrl",
    );
  });
});

describe("token list", () => {
  it("scans with a token filter across pages and sorts by creation", async () => {
    ddbMock
      .on(ScanCommand)
      .resolvesOnce({
        Items: [item("bbbbbbbbbbbb", { createdAt: "2026-11-02T00:00:00.000Z", revoked: true })],
        LastEvaluatedKey: { PK: "x", SK: "token" },
      })
      .resolvesOnce({ Items: [item("aaaaaaaaaaaa", { label: "" })] });
    const h = await harness();
    expect(await token(["list"], h.ctx)).toBe(0);
    const scans = ddbMock.commandCalls(ScanCommand);
    expect(scans[0]!.args[0].input.FilterExpression).toBe("SK = :sk");
    expect(scans[1]!.args[0].input.ExclusiveStartKey).toEqual({ PK: "x", SK: "token" });
    expect(h.out[1]).toContain("aaaaaaaa  -  a/b");
    expect(h.out[1]).toContain("active");
    expect(h.out[2]).toContain("bbbbbbbb  ci  a/b  2027-01-15T08:00:00.000Z  revoked");
  });

  it("handles an empty table", async () => {
    ddbMock.on(ScanCommand).resolves({});
    const h = await harness();
    await token(["list"], h.ctx);
    expect(h.out).toEqual(["No tokens"]);
  });
});

describe("token revoke", () => {
  it("revokes the unique match", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [item("abcd1234ff"), item("ffff0000aa")] });
    ddbMock.on(UpdateCommand).resolves({});
    const h = await harness();
    expect(await token(["revoke", "abcd"], h.ctx)).toBe(0);
    const update = ddbMock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.Key).toEqual({ PK: "token#abcd1234ff", SK: "token" });
    expect(update.ExpressionAttributeValues).toEqual({ ":t": true });
    expect(h.out).toEqual(["Revoked token abcd1234"]);
  });

  it("rejects short, unknown, and ambiguous prefixes", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [item("abcd1"), item("abcd2")] });
    const h = await harness();
    await expect(token(["revoke"], h.ctx)).rejects.toThrow("id prefix");
    await expect(token(["revoke", "ab"], h.ctx)).rejects.toThrow("id prefix");
    await expect(token(["revoke", "zzzz"], h.ctx)).rejects.toThrow('no token matches "zzzz"');
    await expect(token(["revoke", "abcd"], h.ctx)).rejects.toThrow("matches 2 tokens");
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});

describe("token usage", () => {
  it("prints help and rejects unknown subcommands", async () => {
    const h = await harness();
    expect(await token(["--help"], h.ctx)).toBe(0);
    expect(h.out[0]).toContain("hook-harness token");
    await expect(token([], h.ctx)).rejects.toThrow("usage:");
    await expect(token(["frob"], h.ctx)).rejects.toThrow("usage:");
  });

  it("surfaces describe failures", async () => {
    cfnMock.on(DescribeStacksCommand).rejects(new Error("denied"));
    const h = await harness();
    await expect(token(["list"], h.ctx)).rejects.toThrow("denied");
  });
});
