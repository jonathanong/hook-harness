import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from "@aws-sdk/client-cloudformation";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

import { createClients } from "../aws/clients.ts";
import type { Ctx } from "../types.ts";

export const cfnMock = mockClient(CloudFormationClient);
export const lambdaMock = mockClient(LambdaClient);
export const ddbMock = mockClient(DynamoDBDocumentClient);

export interface Harness {
  ctx: Ctx;
  out: string[];
  err: string[];
  dir: string;
  fetched: string[];
}

/** A Ctx writing into a temp dir with a template and bundle fixture. */
export async function harness(over: Partial<Ctx> = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "hh-cli-"));
  await mkdir(join(dir, "dist"));
  await writeFile(join(dir, "template.yaml"), "Resources: {}\n");
  await writeFile(join(dir, "dist", "index.mjs"), "export const handler = () => {};\n");
  const out: string[] = [];
  const err: string[] = [];
  const fetched: string[] = [];
  const env = { HOOK_HARNESS_CONFIG_DIR: join(dir, "config") };
  const ctx: Ctx = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    env,
    clients: (options) => createClients({ region: "us-east-1", ...options }, {}),
    fetch: async (url) => {
      fetched.push(String(url));
      return new Response("", { status: 401 });
    },
    randomBytes: (size) => Buffer.alloc(size, 1),
    now: () => new Date("2026-11-09T00:00:00.000Z"),
    maxWaitSeconds: 60,
    paths: { template: join(dir, "template.yaml"), bundle: join(dir, "dist", "index.mjs") },
    ...over,
  };
  return { ctx, out, err, dir, fetched };
}

export const OUTPUTS = [
  { OutputKey: "FunctionUrl", OutputValue: "https://abc.lambda-url.us-east-1.on.aws" },
  { OutputKey: "FunctionName", OutputValue: "hook-harness-fn" },
  { OutputKey: "TableName", OutputValue: "hook-harness-table" },
];

export function validationError(message: string): Error {
  return Object.assign(new Error(message), { name: "ValidationError" });
}

/** A stateful fake stack: create/update/delete flip what DescribeStacks reports. */
export function stubStack(options: { exists: boolean; parameters?: string[]; outputs?: boolean }) {
  const state = { exists: options.exists, status: "CREATE_COMPLETE" };
  cfnMock.on(DescribeStacksCommand).callsFake(() => {
    if (!state.exists) throw validationError("Stack with id hook-harness does not exist");
    return {
      Stacks: [
        {
          StackName: "hook-harness",
          StackStatus: state.status,
          CreationTime: new Date(),
          Parameters: (options.parameters ?? []).map((ParameterKey) => ({ ParameterKey })),
          Outputs: options.outputs === false ? [] : OUTPUTS,
        },
      ],
    };
  });
  cfnMock.on(CreateStackCommand).callsFake(() => {
    state.exists = true;
    state.status = "CREATE_COMPLETE";
    return {};
  });
  cfnMock.on(UpdateStackCommand).callsFake(() => {
    state.status = "UPDATE_COMPLETE";
    return {};
  });
  cfnMock.on(DeleteStackCommand).callsFake(() => {
    state.exists = false;
    return {};
  });
  return state;
}
