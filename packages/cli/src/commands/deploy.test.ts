import {
  CreateStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import { GetFunctionCommand, UpdateFunctionCodeCommand } from "@aws-sdk/client-lambda";
import { rm } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";

import { readState } from "../state.ts";
import { cfnMock, harness, lambdaMock, stubStack } from "../test-helpers/ctx.ts";
import { deploy, update } from "./deploy.ts";

beforeEach(() => {
  cfnMock.reset();
  lambdaMock.reset();
  lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
  lambdaMock.on(GetFunctionCommand).resolves({
    Configuration: { State: "Active", LastUpdateStatus: "Successful" },
  });
});

describe("deploy on a new stack", () => {
  it("creates the stack, uploads code, and shows a generated secret once", async () => {
    stubStack({ exists: false });
    const h = await harness();
    expect(await deploy(["--region", "us-east-1"], h.ctx)).toBe(0);

    const create = cfnMock.commandCalls(CreateStackCommand)[0]!.args[0].input;
    expect(create.StackName).toBe("hook-harness");
    expect(create.Capabilities).toEqual(["CAPABILITY_IAM"]);
    expect(create.Parameters).toEqual([
      { ParameterKey: "WebhookSecret", ParameterValue: "01".repeat(32) },
    ]);

    const upload = lambdaMock.commandCalls(UpdateFunctionCodeCommand)[0]!.args[0].input;
    expect(upload.FunctionName).toBe("hook-harness-fn");
    expect(Buffer.from(upload.ZipFile as Uint8Array).readUInt32LE(0)).toBe(0x04034b50);

    const text = h.out.join("\n");
    expect(text).toContain("https://abc.lambda-url.us-east-1.on.aws/webhook");
    expect(text).toContain(`Webhook secret:      ${"01".repeat(32)}`);
    const state = await readState(h.ctx.env, "hook-harness");
    expect(state).toMatchObject({
      region: "us-east-1",
      functionUrl: "https://abc.lambda-url.us-east-1.on.aws/",
      webhookSecret: "01".repeat(32),
      tableName: "hook-harness-table",
    });
  });

  it("uses a given secret and parameters without printing the secret", async () => {
    stubStack({ exists: false });
    const h = await harness();
    await deploy(
      ["--webhook-secret", "s3", "--billing-mode", "PAY_PER_REQUEST", "--stack", "x"],
      h.ctx,
    );
    const create = cfnMock.commandCalls(CreateStackCommand)[0]!.args[0].input;
    expect(create.StackName).toBe("x");
    expect(create.Parameters).toEqual([
      { ParameterKey: "WebhookSecret", ParameterValue: "s3" },
      { ParameterKey: "BillingMode", ParameterValue: "PAY_PER_REQUEST" },
    ]);
    expect(h.out.join("\n")).not.toContain("s3");
    expect((await readState(h.ctx.env, "x"))?.webhookSecret).toBe("s3");
  });

  it("rejects a bad billing mode before creating anything", async () => {
    stubStack({ exists: false });
    const h = await harness();
    await expect(deploy(["--billing-mode", "FREE"], h.ctx)).rejects.toThrow("--billing-mode");
    expect(cfnMock.commandCalls(CreateStackCommand)).toHaveLength(0);
  });

  it("fails early with a build hint when the bundle is missing", async () => {
    const h = await harness();
    await rm(h.ctx.paths.bundle);
    await expect(deploy([], h.ctx)).rejects.toThrow("pnpm build");
    expect(cfnMock.calls()).toHaveLength(0);
  });

  it("prints help", async () => {
    const h = await harness();
    expect(await deploy(["--help"], h.ctx)).toBe(0);
    expect(await update(["-h"], h.ctx)).toBe(0);
    expect(h.out[0]).toContain("hook-harness deploy");
    expect(h.out[1]).toContain("hook-harness update");
  });
});

describe("deploy and update on an existing stack", () => {
  it("keeps previous parameter values and updates the template", async () => {
    stubStack({ exists: true, parameters: ["WebhookSecret", "BillingMode"] });
    const h = await harness();
    expect(await deploy(["--read-capacity", "10"], h.ctx)).toBe(0);
    const input = cfnMock.commandCalls(UpdateStackCommand)[0]!.args[0].input;
    expect(input.Parameters).toEqual([
      { ParameterKey: "WebhookSecret", UsePreviousValue: true },
      { ParameterKey: "BillingMode", UsePreviousValue: true },
      { ParameterKey: "ReadCapacity", ParameterValue: "10" },
    ]);
    expect(cfnMock.commandCalls(CreateStackCommand)).toHaveLength(0);
    expect(h.out.join("\n")).not.toContain("Webhook secret:");
    expect(h.out).toContain("Updated stack hook-harness");
  });

  it("update keeps a saved secret in the state file and refreshes code", async () => {
    stubStack({ exists: true, parameters: ["WebhookSecret"] });
    const h = await harness();
    await deploy(["--webhook-secret", "keep"], h.ctx);
    expect(await update([], h.ctx)).toBe(0);
    expect((await readState(h.ctx.env, "hook-harness"))?.webhookSecret).toBe("keep");
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(2);
  });

  it("treats 'No updates' as success and still uploads code (code-only change)", async () => {
    stubStack({ exists: true, parameters: ["WebhookSecret"] });
    cfnMock.on(UpdateStackCommand).rejects(new Error("No updates are to be performed."));
    const h = await harness();
    expect(await update([], h.ctx)).toBe(0);
    expect(h.out).toContain("Stack hook-harness template is unchanged");
    expect(lambdaMock.commandCalls(UpdateFunctionCodeCommand)).toHaveLength(1);
  });

  it("surfaces other update errors", async () => {
    stubStack({ exists: true });
    cfnMock.on(UpdateStackCommand).rejects(new Error("boom"));
    const h = await harness();
    await expect(update([], h.ctx)).rejects.toThrow("boom");
  });

  it("surfaces other describe errors", async () => {
    cfnMock.on(DescribeStacksCommand).rejects(new Error("denied"));
    const h = await harness();
    await expect(deploy([], h.ctx)).rejects.toThrow("denied");
  });

  it("update refuses to create a missing stack", async () => {
    stubStack({ exists: false });
    const h = await harness();
    await expect(update([], h.ctx)).rejects.toThrow("does not exist");
    expect(cfnMock.commandCalls(CreateStackCommand)).toHaveLength(0);
  });
});
