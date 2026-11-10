import { COMMON_HELP, parse } from "../args.ts";
import type { Command, Ctx } from "../types.ts";
import { collect, type Collected } from "../watch/collect.ts";
import { encodeCursor } from "../watch/cursor.ts";
import { LOGIN_HELP, WATCH_FLAGS, WATCH_SPEC } from "../watch/flags.ts";
import { openSession, type Session } from "../watch/session.ts";

const HELP = `hook-harness wait --owner <owner> [flags]

Blocks until matching events arrive, prints ONE JSON object, and exits 0:
  {"events":[...],"gap":false,"cursor":"..."}                matched (after --settle)
  {"events":[...],"gap":true,"cursor":"..."}                 relay history gap; re-sync now
  {"events":[],"gap":false,"timedOut":true,"cursor":"..."}   --timeout elapsed, nothing matched
Exit code is 0 in all three cases so background-command harnesses just wake up; read the JSON.
Exit 1: auth failure (401/403), invalid cursor, or the relay unreachable until --timeout.

Pass the printed "cursor" back as --after on your next wait to resume exactly there.

${WATCH_FLAGS}
  --timeout <d>            Give up after this long with no match (default 30m)

${COMMON_HELP}

${LOGIN_HELP}`;

function report(ctx: Ctx, result: Collected): void {
  ctx.out(
    JSON.stringify({
      events: result.events,
      gap: result.gap,
      ...(result.timedOut ? { timedOut: true } : {}),
      cursor: encodeCursor(result.cursor),
    }),
  );
}

async function run(session: Session, ctx: Ctx): Promise<number> {
  const result = await collect(session, ctx);
  if (!result) return 130; // interrupted before anything was delivered
  report(ctx, result);
  await session.save(result.cursor);
  return 0;
}

export const wait: Command = async (args, ctx) => {
  const { values } = parse(args, WATCH_SPEC);
  if (values.help) {
    ctx.out(HELP);
    return 0;
  }
  return run(await openSession(values, ctx, "30m"), ctx);
};
