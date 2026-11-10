import { DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { beforeEach, describe, expect, it } from "vitest";

import { cfnMock } from "../test-helpers/ctx.ts";
import { createClients } from "./clients.ts";
import { describeStack, outputsOf } from "./cfn.ts";

beforeEach(() => cfnMock.reset());

describe("cfn helpers", () => {
  it("treats an empty Stacks list as missing", async () => {
    cfnMock.on(DescribeStacksCommand).resolves({});
    expect(
      await describeStack(createClients({ region: "us-east-1" }, {}).cfn, "s"),
    ).toBeUndefined();
  });

  it("collects outputs and tolerates none", () => {
    expect(
      outputsOf({ StackName: "s", CreationTime: new Date(), StackStatus: "CREATE_COMPLETE" }),
    ).toEqual({});
    expect(
      outputsOf({
        StackName: "s",
        CreationTime: new Date(),
        StackStatus: "CREATE_COMPLETE",
        Outputs: [{ OutputKey: "A", OutputValue: "1" }, { OutputKey: "B" }, { OutputValue: "3" }],
      }),
    ).toEqual({ A: "1" });
  });
});
