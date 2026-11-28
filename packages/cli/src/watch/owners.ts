import type { ClientConfig } from "../client/config.ts";
import type { Ctx } from "../types.ts";
import { relaySource, type Query } from "./source.ts";
import type { EventSource, PollResult } from "./types.ts";

type Settled =
  | { index: number; result: IteratorResult<PollResult> }
  | { index: number; error: unknown };

/**
 * Interleaves several polls as their results arrive. A poll is resumed only after the consumer
 * has handled its last result, so its `delay()` sees the consumer's latest state. With `once`,
 * each poll gives only its first result.
 */
async function* merge(
  polls: AsyncGenerator<PollResult>[],
  once: boolean,
): AsyncGenerator<PollResult> {
  const pending = new Map<number, Promise<Settled>>();
  const pull = (index: number): void => {
    pending.set(
      index,
      polls[index]!.next().then(
        (result) => ({ index, result }),
        (error: unknown) => ({ index, error }),
      ),
    );
  };
  polls.forEach((_, index) => pull(index));
  while (pending.size > 0) {
    const settled = await Promise.race(pending.values());
    pending.delete(settled.index);
    if ("error" in settled) throw settled.error;
    if (settled.result.done) continue;
    yield settled.result.value;
    if (!once) pull(settled.index);
  }
}

async function* tagged(
  owner: string,
  poll: AsyncGenerator<PollResult>,
): AsyncGenerator<PollResult> {
  for await (const result of poll) {
    yield "error" in result
      ? { error: new Error(`${owner}: ${result.error.message}`), owner }
      : { ...result, owner };
  }
}

/**
 * Polls the relay for each owner. One owner is a plain relay source; several run side by side,
 * each from its own position in the start cursor, and every result names its owner. `once` asks
 * each owner for one page only (no follow-up when the relay says there is more).
 */
export function ownersSource(
  ctx: Ctx,
  client: ClientConfig,
  query: Omit<Query, "owner">,
  owners: string[],
  intervalMs: number,
  once = false,
): EventSource {
  if (owners.length === 1)
    return relaySource(ctx, client, { ...query, owner: owners[0]! }, intervalMs);
  return {
    async *poll(start, delay): AsyncGenerator<PollResult> {
      // Stops every owner's poll (and its sleep) once the consumer is done with this one.
      const stop = new AbortController();
      const scoped: Ctx = { ...ctx, signal: AbortSignal.any([ctx.signal, stop.signal]) };
      const polls = owners.map((owner) => {
        const source = relaySource(scoped, client, { ...query, owner }, intervalMs);
        return tagged(owner, source.poll(start.owners![owner]!, delay));
      });
      try {
        yield* merge(polls, once);
      } finally {
        stop.abort();
      }
    },
  };
}
