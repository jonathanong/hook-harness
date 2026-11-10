import { str, UsageError, type Values } from "../args.ts";
import type { Clients } from "../aws/clients.ts";
import { describeStack, outputsOf, type Outputs } from "../aws/cfn.ts";
import type { Ctx } from "../types.ts";

export const DEFAULT_STACK = "hook-harness";

export interface Connection {
  stack: string;
  region: string | undefined;
  clients: Clients;
}

export function connect(values: Values, ctx: Ctx): Connection {
  const region = str(values, "region");
  const clients = ctx.clients({ region, profile: str(values, "profile") });
  return { stack: str(values, "stack") ?? DEFAULT_STACK, region, clients };
}

/** Function URLs end in `/`; make that certain so `<url>webhook` always works. */
export function withSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** Stack outputs for a stack that must exist and carry the relay outputs. */
export async function requireOutputs(conn: Connection): Promise<Outputs> {
  const stack = await describeStack(conn.clients.cfn, conn.stack);
  if (!stack)
    throw new UsageError(`stack "${conn.stack}" does not exist; run \`hook-harness deploy\``);
  const outputs = outputsOf(stack);
  for (const key of ["FunctionUrl", "FunctionName", "TableName"]) {
    if (!outputs[key]) throw new Error(`stack "${conn.stack}" is missing output ${key}`);
  }
  return outputs;
}
