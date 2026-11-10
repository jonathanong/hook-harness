import { UsageError } from "./args.ts";
import { deploy, update } from "./commands/deploy.ts";
import { status } from "./commands/status.ts";
import { teardown } from "./commands/teardown.ts";
import { token } from "./commands/token.ts";
import type { Command, Ctx } from "./types.ts";

/** Command table keyed by name. The runner package adds `run` and `service` through `extra`. */
export const builtinCommands: Record<string, Command> = {
  deploy,
  update,
  teardown,
  status,
  token,
};

export const USAGE = `hook-harness <command> [flags]

Commands:
  deploy      Create or update the stack and upload the relay code
  update      Update an existing stack and the relay code (never creates)
  teardown    Delete the stack (requires --yes)
  status      Show stack, function, and a liveness check
  token       create | list | revoke relay tokens

Run \`hook-harness <command> --help\` for flags.`;

export async function main(
  argv: string[],
  ctx: Ctx,
  extra: Record<string, Command> = {},
): Promise<number> {
  const [name, ...rest] = argv;
  const commands = { ...builtinCommands, ...extra };
  if (name === undefined || name === "--help" || name === "-h" || name === "help") {
    ctx.out(USAGE);
    return name === undefined ? 1 : 0;
  }
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command) {
    ctx.err(`error: unknown command "${name}"\n\n${USAGE}`);
    return 2;
  }
  try {
    return await command(rest, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.err(`error: ${message}`);
    return error instanceof UsageError ? 2 : 1;
  }
}
