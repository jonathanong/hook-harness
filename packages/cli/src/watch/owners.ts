import type { ClientConfig } from "../client/config.ts";
import { merge } from "../client/merge.ts";
import type { Ctx } from "../types.ts";
import { relaySource, type Query } from "./source.ts";
import type { EventSource, PollResult } from "./types.ts";

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
