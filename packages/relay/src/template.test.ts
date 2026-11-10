import { readFileSync } from "node:fs";

import { parse, type CollectionTag, type ScalarTag } from "yaml";
import { describe, expect, it } from "vitest";

const names = ["Ref", "Sub", "GetAtt", "If", "Equals"];
const scalars: ScalarTag[] = names.map((name) => ({
  tag: `!${name}`,
  resolve: (value: string) => ({ [name === "Ref" ? name : `Fn::${name}`]: value }),
}));
const seqs: CollectionTag[] = names.map((name) => ({
  tag: `!${name}`,
  collection: "seq",
  resolve: (seq) => ({ [`Fn::${name}`]: seq.toJSON() }),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
const template: any = parse(readFileSync(new URL("../template.yaml", import.meta.url), "utf8"), {
  customTags: [...scalars, ...seqs],
});
const props = (id: string) => template.Resources[id].Properties;

describe("template.yaml", () => {
  it("declares the parameters", () => {
    const p = template.Parameters;
    expect(Object.keys(p).sort()).toEqual(
      [
        "BillingMode",
        "Commands",
        "PayloadDrop",
        "PayloadMaxBytes",
        "ReadCapacity",
        "WebhookSecret",
        "WriteCapacity",
      ].sort(),
    );
    expect(p.WebhookSecret.NoEcho).toBe(true);
    expect(p.Commands.Default).toBe("/plan,/fix,/shepherd");
    expect([p.PayloadDrop.Default, p.PayloadMaxBytes.Default]).toEqual([
      "repository,organization",
      1000000,
    ]);
    expect(p.BillingMode.Default).toBe("PROVISIONED");
    expect([p.ReadCapacity.Default, p.WriteCapacity.Default]).toEqual([25, 25]);
  });

  it("defines the table", () => {
    const t = props("Table");
    expect(t.KeySchema).toEqual([
      { AttributeName: "PK", KeyType: "HASH" },
      { AttributeName: "SK", KeyType: "RANGE" },
    ]);
    expect(t.TimeToLiveSpecification).toEqual({ AttributeName: "expiresAt", Enabled: true });
    expect(t.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled).toBe(false);
    expect(t.BillingMode).toEqual({ Ref: "BillingMode" });
    expect(t.ProvisionedThroughput["Fn::If"][0]).toBe("IsProvisioned");
    expect(template.Conditions.IsProvisioned["Fn::Equals"]).toEqual([
      { Ref: "BillingMode" },
      "PROVISIONED",
    ]);
  });

  it("limits the role to the table", () => {
    const [statement] = props("FunctionRole").Policies[0].PolicyDocument.Statement;
    expect(statement.Action).toEqual(["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]);
    expect(statement.Resource).toEqual({ "Fn::GetAtt": "Table.Arn" });
    expect(props("FunctionRole").ManagedPolicyArns[0]).toContain("AWSLambdaBasicExecutionRole");
  });

  it("configures the function and its log group", () => {
    const f = props("Function");
    expect(f).toMatchObject({
      Runtime: "nodejs24.x",
      Architectures: ["arm64"],
      MemorySize: 256,
      Timeout: 10,
      Handler: "index.handler",
      LoggingConfig: { LogFormat: "JSON", SystemLogLevel: "WARN", ApplicationLogLevel: "INFO" },
    });
    expect(f.Code.ZipFile).toContain("503");
    expect(Object.keys(f.Environment.Variables).sort()).toEqual([
      "COMMANDS",
      "PAYLOAD_DROP",
      "PAYLOAD_MAX_BYTES",
      "TABLE_NAME",
      "WEBHOOK_SECRET",
    ]);
    expect(props("LogGroup").RetentionInDays).toBe(1);
    expect(props("LogGroup").LogGroupName["Fn::Sub"]).toBe("/aws/lambda/${AWS::StackName}-relay");
    expect(f.FunctionName["Fn::Sub"]).toBe("${AWS::StackName}-relay");
  });

  it("exposes a public function URL with both permissions", () => {
    expect(props("FunctionUrl").AuthType).toBe("NONE");
    expect(props("UrlInvokePermission")).toMatchObject({
      Action: "lambda:InvokeFunctionUrl",
      FunctionUrlAuthType: "NONE",
    });
    expect(props("InvokePermission")).toMatchObject({
      Action: "lambda:InvokeFunction",
      InvokedViaFunctionUrl: true,
    });
  });

  it("outputs the URL, function and table", () => {
    expect(Object.keys(template.Outputs).sort()).toEqual([
      "FunctionName",
      "FunctionUrl",
      "TableName",
    ]);
  });
});
