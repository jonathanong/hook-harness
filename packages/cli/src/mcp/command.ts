import type { Readable, Writable } from "node:stream";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { parse } from "../args.ts";
import type { Ctx } from "../types.ts";
import { createServer } from "./server.ts";

const HELP = `hook-harness mcp

Runs an MCP server on stdio exposing GitHub events as tools:
  wait_for_events   block until matching events arrive (like \`hook-harness wait\`)
  get_events        a single non-blocking poll
  filter_help       EventFilter fields and examples
Stdout carries only the MCP protocol; diagnostics go to stderr. No cursor state is kept unless a
tool call passes cursor_name; callers pass the returned cursor back as \`after\`.

Login: \`hook-harness login\`, or HOOK_HARNESS_URL and HOOK_HARNESS_TOKEN.

Add it to a client:
  claude mcp add hook-harness -- npx -y hook-harness mcp`;

/** Serves until the transport closes or `ctx.signal` aborts. */
export async function serve(ctx: Ctx, transport: Transport): Promise<number> {
  const server = createServer(ctx);
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = resolve;
  });
  await server.connect(transport);
  ctx.err("hook-harness mcp: serving on stdio");
  const onAbort = (): void => void server.close();
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  await closed;
  ctx.signal.removeEventListener("abort", onAbort);
  return 0;
}

export const mcp = async (
  args: string[],
  ctx: Ctx,
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Promise<number> => {
  const { values } = parse(args);
  if (values.help) {
    ctx.out(HELP);
    return 0;
  }
  const transport = new StdioServerTransport(stdin, stdout);
  stdin.once("end", () => void transport.close());
  return serve(ctx, transport);
};
