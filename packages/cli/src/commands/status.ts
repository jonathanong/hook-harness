import { COMMON_HELP, parse } from "../args.ts";
import { describeStack, outputsOf } from "../aws/cfn.ts";
import { lastModified } from "../aws/lambda.ts";
import type { Command, Ctx } from "../types.ts";
import { connect, withSlash } from "./common.ts";

const HELP = `hook-harness status [flags]

Shows stack status and outputs, the function's last-modified time, and checks that the function
is live by calling GET <url>events?owner=x without a token (expects 401).

${COMMON_HELP}`;

async function smokeCheck(ctx: Ctx, functionUrl: string): Promise<boolean> {
  try {
    const response = await ctx.fetch(`${withSlash(functionUrl)}events?owner=x`);
    ctx.out(`Smoke check: GET events without a token -> ${response.status} (expected 401)`);
    return response.status === 401;
  } catch (error) {
    ctx.out(`Smoke check: request failed (${(error as Error).message})`);
    return false;
  }
}

export const status: Command = async (args, ctx) => {
  const { values } = parse(args);
  if (values.help) {
    ctx.out(HELP);
    return 0;
  }
  const conn = connect(values, ctx);
  const stack = await describeStack(conn.clients.cfn, conn.stack);
  if (!stack) {
    ctx.out(`Stack ${conn.stack}: not deployed`);
    return 1;
  }
  ctx.out(`Stack ${conn.stack}: ${stack.StackStatus}`);
  const outputs = outputsOf(stack);
  for (const [key, value] of Object.entries(outputs)) ctx.out(`  ${key}: ${value}`);
  if (!outputs.FunctionName || !outputs.FunctionUrl) {
    ctx.out("Stack has no function outputs yet");
    return 1;
  }
  ctx.out(
    `Function last modified: ${await lastModified(conn.clients.lambda, outputs.FunctionName)}`,
  );
  return (await smokeCheck(ctx, outputs.FunctionUrl)) ? 0 : 1;
};
