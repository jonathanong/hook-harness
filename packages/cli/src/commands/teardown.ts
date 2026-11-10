import { COMMON_HELP, parse, UsageError } from "../args.ts";
import { deleteStack, describeStack } from "../aws/cfn.ts";
import { removeState } from "../state.ts";
import type { Command } from "../types.ts";
import { connect } from "./common.ts";

const HELP = `hook-harness teardown --yes [flags]

Deletes the stack (function, table, and the stack-owned log group) and the local state file.
Succeeds if the stack is already gone.

Flags:
  --yes   Required: confirm deletion

${COMMON_HELP}`;

export const teardown: Command = async (args, ctx) => {
  const { values } = parse(args, { yes: { type: "boolean" } });
  if (values.help) {
    ctx.out(HELP);
    return 0;
  }
  if (!values.yes) throw new UsageError("teardown deletes the stack; pass --yes to confirm");
  const conn = connect(values, ctx);
  // The relay's log group is declared in the template, so deleting the stack removes it too.
  if (await describeStack(conn.clients.cfn, conn.stack)) {
    await deleteStack(conn.clients.cfn, conn.stack, ctx.maxWaitSeconds);
    ctx.out(`Deleted stack ${conn.stack}`);
  } else {
    ctx.out(`Stack ${conn.stack} is already gone`);
  }
  await removeState(ctx.env, conn.stack);
  return 0;
};
