import { COMMON_HELP, parse, str, UsageError } from "../args.ts";
import { writeClient } from "../client.ts";
import type { Command } from "../types.ts";

const HELP = `hook-harness login --url <function url> --token <hh_...>

Saves the relay URL and token to client.json (mode 0600) in the config directory
(HOOK_HARNESS_CONFIG_DIR, XDG_CONFIG_HOME, or ~/.config/hook-harness) for wait and tail.
HOOK_HARNESS_URL and HOOK_HARNESS_TOKEN override the saved values.

${COMMON_HELP}`;

export const login: Command = async (args, ctx) => {
  const { values } = parse(args, { url: { type: "string" }, token: { type: "string" } });
  if (values.help) {
    ctx.out(HELP);
    return 0;
  }
  const url = str(values, "url");
  const token = str(values, "token");
  if (!url || !token) throw new UsageError("login needs --url and --token");
  ctx.out(`Saved login to ${await writeClient(ctx.env, { url, token })}`);
  return 0;
};
