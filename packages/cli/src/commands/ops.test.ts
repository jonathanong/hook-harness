import { DeleteStackCommand, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { beforeEach, describe, expect, it } from "vitest";

import { readState, writeState } from "../state.ts";
import { cfnMock, harness, lambdaMock, stubStack } from "../test-helpers/ctx.ts";
import { status } from "./status.ts";
import { teardown } from "./teardown.ts";

beforeEach(() => {
  cfnMock.reset();
  lambdaMock.reset();
  lambdaMock
    .on(GetFunctionConfigurationCommand)
    .resolves({ LastModified: "2026-11-08T00:00:00.000+0000" });
});

describe("teardown", () => {
  it("refuses without --yes", async () => {
    const h = await harness();
    await expect(teardown([], h.ctx)).rejects.toThrow("--yes");
    expect(cfnMock.calls()).toHaveLength(0);
  });

  it("deletes the stack and the state file", async () => {
    stubStack({ exists: true });
    const h = await harness();
    await writeState(h.ctx.env, {
      stack: "hook-harness",
      functionUrl: "u",
      webhookUrl: "w",
      functionName: "f",
      tableName: "t",
      updatedAt: "now",
    });
    expect(await teardown(["--yes"], h.ctx)).toBe(0);
    expect(cfnMock.commandCalls(DeleteStackCommand)).toHaveLength(1);
    expect(await readState(h.ctx.env, "hook-harness")).toBeUndefined();
    expect(h.out).toContain("Deleted stack hook-harness");
  });

  it("succeeds when the stack is already gone", async () => {
    stubStack({ exists: false });
    const h = await harness();
    expect(await teardown(["--yes"], h.ctx)).toBe(0);
    expect(cfnMock.commandCalls(DeleteStackCommand)).toHaveLength(0);
    expect(h.out).toContain("Stack hook-harness is already gone");
  });

  it("prints help", async () => {
    const h = await harness();
    expect(await teardown(["--help"], h.ctx)).toBe(0);
    expect(h.out[0]).toContain("hook-harness teardown");
  });
});

describe("status", () => {
  it("reports stack, outputs, function and a passing smoke check", async () => {
    stubStack({ exists: true });
    const h = await harness();
    expect(await status([], h.ctx)).toBe(0);
    const text = h.out.join("\n");
    expect(text).toContain("Stack hook-harness: CREATE_COMPLETE");
    expect(text).toContain("FunctionName: hook-harness-fn");
    expect(text).toContain("Function last modified: 2026-11-08");
    expect(text).toContain("-> 401");
    expect(h.fetched).toEqual(["https://abc.lambda-url.us-east-1.on.aws/events?repo=x/y"]);
  });

  it("fails the smoke check on an unexpected status", async () => {
    stubStack({ exists: true });
    const h = await harness({ fetch: async () => new Response("", { status: 200 }) });
    expect(await status([], h.ctx)).toBe(1);
  });

  it("fails the smoke check when the request errors", async () => {
    stubStack({ exists: true });
    const h = await harness({
      fetch: async () => {
        throw new Error("offline");
      },
    });
    expect(await status([], h.ctx)).toBe(1);
    expect(h.out.join("\n")).toContain("request failed (offline)");
  });

  it("reports a missing stack", async () => {
    stubStack({ exists: false });
    const h = await harness();
    expect(await status([], h.ctx)).toBe(1);
    expect(h.out).toEqual(["Stack hook-harness: not deployed"]);
  });

  it("reports a stack without function outputs", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({
      Stacks: [{ StackName: "s", StackStatus: "CREATE_IN_PROGRESS", CreationTime: new Date() }],
    });
    const h = await harness();
    expect(await status([], h.ctx)).toBe(1);
    expect(h.out.at(-1)).toBe("Stack has no function outputs yet");
  });

  it("prints help", async () => {
    const h = await harness();
    expect(await status(["--help"], h.ctx)).toBe(0);
    expect(h.out[0]).toContain("hook-harness status");
  });
});
