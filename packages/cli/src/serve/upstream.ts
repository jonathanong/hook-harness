import type { Ctx } from "../types.ts";
import { advance, encodeCursor, type Cursor } from "../watch/cursor.ts";
import type { Session } from "../watch/session.ts";
import type { RingBuffer } from "./buffer.ts";
import type { Hub } from "./hub.ts";

/** What `/healthz` reports about the relay poll loop. */
export interface Health {
  lastPollAt: string | null;
  lastError: string | null;
  cursor: string;
}

export interface Upstream {
  health: Health;
  cursor: Cursor;
}

export function newUpstream(cursor: Cursor): Upstream {
  return { health: { lastPollAt: null, lastError: null, cursor: encodeCursor(cursor) }, cursor };
}

/**
 * Polls the relay once for everyone, with the same source (retry and backoff) as `tail`.
 * Resolves when the source stops (abort); rejects on auth failure.
 */
export async function pollUpstream(
  session: Session,
  ctx: Ctx,
  upstream: Upstream,
  buffer: RingBuffer,
  hub: Hub,
): Promise<void> {
  const { health } = upstream;
  for await (const result of session.source.poll(upstream.cursor.sk, () => session.intervalMs)) {
    const now = ctx.now();
    health.lastPollAt = now.toISOString();
    buffer.prune(now.getTime());
    if ("error" in result) {
      health.lastError = result.error.message;
      ctx.err(`warning: ${result.error.message}; retrying`);
      continue;
    }
    health.lastError = null;
    const step = advance(upstream.cursor, result.page);
    upstream.cursor = step.next;
    health.cursor = encodeCursor(step.next);
    if (result.page.gap) hub.gap(health.cursor);
    for (const event of step.fresh) {
      hub.publish(buffer.push(event, result.page.cursor, now.getTime()));
    }
    await session.save(step.next);
  }
}
