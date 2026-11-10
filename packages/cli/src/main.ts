import { UsageError } from "./args.ts";
import { deploy, update } from "./commands/deploy.ts";
import { login } from "./commands/login.ts";
import { status } from "./commands/status.ts";
import { tail } from "./commands/tail.ts";
import { teardown } from "./commands/teardown.ts";
import { token } from "./commands/token.ts";
import { wait } from "./commands/wait.ts";
import type { Command, Ctx } from "./types.ts";

/** Command table keyed by name. The runner package adds `run` and `service` through `extra`. */
export const builtinCommands: Record<string, Command> = {
  deploy,
  update,
  teardown,
  status,
  token,
  login,
  wait,
  tail,
};

export const USAGE = `hook-harness <command> [flags]

Commands:
  deploy      Create or update the stack and upload the relay code
  update      Update an existing stack and the relay code (never creates)
  teardown    Delete the stack (requires --yes)
  status      Show stack, function, and a liveness check
  token       create | list | revoke relay tokens
  login       Save the relay URL and token for wait/tail
  wait        Block until matching events arrive, print one JSON object (primary interface)
  tail        Stream matching events as NDJSON (primary interface)

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
