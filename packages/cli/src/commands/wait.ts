import type { Envelope } from "@hook-harness/protocol";

import { COMMON_HELP, parse } from "../args.ts";
import type { Command, Ctx } from "../types.ts";
import { advance, encodeCursor, type Cursor } from "../watch/cursor.ts";
import { WATCH_FLAGS, WATCH_SPEC } from "../watch/flags.ts";
import { matchesAny, openSession, type Session } from "../watch/session.ts";

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

${COMMON_HELP}`;

function report(
  ctx: Ctx,
  cursor: Cursor,
  events: Envelope[],
  extra: { gap?: boolean; timedOut?: true },
): void {
  ctx.out(
    JSON.stringify({
      events,
      gap: extra.gap ?? false,
      ...(extra.timedOut ? { timedOut: true } : {}),
      cursor: encodeCursor(cursor),
    }),
  );
}

async function run(session: Session, ctx: Ctx): Promise<number> {
  const startedAt = ctx.now().getTime();
  const elapsed = (): number => ctx.now().getTime() - startedAt;
  let cursor = session.cursor;
  let settleAt: number | undefined;
  const matched: Envelope[] = [];
  const delay = (): number =>
    settleAt === undefined
      ? session.intervalMs
      : Math.max(0, Math.min(session.intervalMs, settleAt - ctx.now().getTime()));

  const finish = async (extra: { gap?: boolean; timedOut?: true }): Promise<number> => {
    report(ctx, cursor, matched, extra);
    await session.save(cursor);
    return 0;
  };

  for await (const result of session.source.poll(cursor.sk, delay)) {
    if ("error" in result) {
      if (matched.length > 0) return finish({});
      if (elapsed() >= session.timeoutMs) throw result.error;
      continue;
    }
    const step = advance(cursor, result.page);
    cursor = step.next;
    matched.push(...step.fresh.filter((event) => matchesAny(session.filters, event)));
    if (result.page.gap) return finish({ gap: true });
    if (matched.length > 0 && settleAt === undefined) {
      settleAt = ctx.now().getTime() + session.settleMs;
    }
    if (settleAt !== undefined && ctx.now().getTime() >= settleAt) return finish({});
    if (matched.length === 0 && elapsed() >= session.timeoutMs) return finish({ timedOut: true });
  }
  return 130; // interrupted before anything was delivered
}

export const wait: Command = async (args, ctx) => {
  const { values } = parse(args, WATCH_SPEC);
  if (values.help) {
    ctx.out(HELP);
    return 0;
  }
  return run(await openSession(values, ctx, "30m"), ctx);
};
