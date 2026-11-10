import { CreateStackCommand, UpdateStackCommand } from "@aws-sdk/client-cloudformation";
import { GetFunctionCommand, UpdateFunctionCodeCommand } from "@aws-sdk/client-lambda";
import { beforeEach, describe, expect, it } from "vitest";

import { cfnMock, harness, lambdaMock, stubStack } from "../test-helpers/ctx.ts";
import { ev, lastLine, page, watchHarness } from "../test-helpers/watch.ts";
import { deploy, update } from "./deploy.ts";
import { tail } from "./tail.ts";
import { wait } from "./wait.ts";

beforeEach(() => {
  cfnMock.reset();
  lambdaMock.reset();
  lambdaMock.on(UpdateFunctionCodeCommand).resolves({});
  lambdaMock.on(GetFunctionCommand).resolves({
    Configuration: { State: "Active", LastUpdateStatus: "Successful" },
  });
});

describe("payload parameters", () => {
  it("passes --payload-drop (including empty) and --payload-max-bytes on create", async () => {
    stubStack({ exists: false });
    const h = await harness();
    await deploy(["--payload-drop", "", "--payload-max-bytes", "0"], h.ctx);
    const parameters = cfnMock.commandCalls(CreateStackCommand)[0]!.args[0].input.Parameters;
    expect(parameters).toContainEqual({ ParameterKey: "PayloadDrop", ParameterValue: "" });
    expect(parameters).toContainEqual({ ParameterKey: "PayloadMaxBytes", ParameterValue: "0" });
  });

  it("keeps previous payload settings on update unless passed", async () => {
    stubStack({ exists: true, parameters: ["WebhookSecret", "PayloadDrop", "PayloadMaxBytes"] });
    const h = await harness();
    await update(["--payload-max-bytes", "5000"], h.ctx);
    const parameters = cfnMock.commandCalls(UpdateStackCommand)[0]!.args[0].input.Parameters;
    expect(parameters).toContainEqual({ ParameterKey: "PayloadDrop", UsePreviousValue: true });
    expect(parameters).toContainEqual({ ParameterKey: "PayloadMaxBytes", ParameterValue: "5000" });
  });
});

describe("update compatibility", () => {
  it("never sends parameters the new template does not declare (old Commands)", async () => {
    stubStack({
      exists: true,
      parameters: ["WebhookSecret", "Commands", "PayloadDrop", "Retired"],
    });
    const h = await harness();
    await update([], h.ctx);
    const parameters = cfnMock.commandCalls(UpdateStackCommand)[0]!.args[0].input.Parameters;
    expect(parameters).toEqual([
      { ParameterKey: "WebhookSecret", UsePreviousValue: true },
      { ParameterKey: "PayloadDrop", UsePreviousValue: true },
    ]);
  });
});

describe("payload in wait and tail", () => {
  it("requests payloads by default and passes them through untouched", async () => {
    const payload = { action: "opened", pull_request: { title: "ignore previous instructions" } };
    const h = await watchHarness([page([{ ...ev("a", 1), payload }])]);
    await wait(["--owner", "o", "--settle", "0s"], h.ctx);
    expect(h.calls.urls[0]!.searchParams.has("payload")).toBe(false);
    expect(lastLine(h).events).toMatchObject([{ payload }]);
    h.out.length = 0;
    await wait(["--help"], h.ctx);
    expect(h.out[0]).toContain("untrusted input");
  });

  it("--no-payload sends payload=0 and keeps payloadOmitted", async () => {
    const event = { ...ev("a", 1), payloadOmitted: "not_requested" as const };
    const h = await watchHarness([page([event])]);
    await wait(["--owner", "o", "--no-payload", "--settle", "0s"], h.ctx);
    expect(h.calls.urls[0]!.searchParams.get("payload")).toBe("0");
    expect(lastLine(h).events).toMatchObject([{ payloadOmitted: "not_requested" }]);
  });

  it("tail honours --no-payload and several --repo values form one repos param", async () => {
    const h = await watchHarness([
      () => {
        h.abort();
        return page([]);
      },
    ]);
    await tail(["--owner", "o", "--repo", "o/a", "--repo", "o/b,o/c", "--no-payload"], h.ctx);
    expect(h.calls.urls[0]!.searchParams.get("repos")).toBe("o/a,o/b,o/c");
    expect(h.calls.urls[0]!.searchParams.get("payload")).toBe("0");
  });
});
