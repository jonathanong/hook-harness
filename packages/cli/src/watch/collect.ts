import type { Envelope } from "@hook-harness/protocol";

import type { Ctx } from "../types.ts";
import { advance, type Cursor } from "./cursor.ts";
import { matchesAny, type Session } from "./session.ts";

export interface Collected {
  events: Envelope[];
  cursor: Cursor;
  gap: boolean;
  timedOut: boolean;
}

/**
 * The blocking poll loop shared by `wait` and the MCP `wait_for_events` tool: collect matches,
 * keep collecting for the settle window after the first, stop on a gap or the timeout.
 * Returns undefined when `ctx.signal` aborts before anything was delivered.
 * `onPoll` fires after every poll with the elapsed milliseconds (progress reporting).
 */
export async function collect(
  session: Session,
  ctx: Ctx,
  onPoll?: (elapsedMs: number) => void,
): Promise<Collected | undefined> {
  const startedAt = ctx.now().getTime();
  const elapsed = (): number => ctx.now().getTime() - startedAt;
  let cursor = session.cursor;
  let settleAt: number | undefined;
  const matched: Envelope[] = [];
  const delay = (): number =>
    settleAt === undefined
      ? session.intervalMs
      : Math.max(0, Math.min(session.intervalMs, settleAt - ctx.now().getTime()));
  const finish = (extra: { gap?: boolean; timedOut?: true }): Collected => ({
    events: matched,
    cursor,
    gap: extra.gap ?? false,
    timedOut: extra.timedOut ?? false,
  });

  for await (const result of session.source.poll(cursor.sk, delay)) {
    onPoll?.(elapsed());
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
  return undefined;
}
