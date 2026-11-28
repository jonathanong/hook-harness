import type { EventFilter } from "@hook-harness/protocol";

import type { ClientConfig } from "../client/config.ts";
import { pollPages } from "../client/poll.ts";
import type { Ctx } from "../types.ts";
import type { EventSource, PollResult } from "./types.ts";

export interface Query {
  owner: string;
  repos: string[];
  payload: boolean;
  /** Sent so the relay drops non-matching events; the caller still filters locally. */
  filters?: EventFilter[];
}

/** Polls the relay's `GET /events`, retrying failures with capped exponential backoff. */
export function relaySource(
  ctx: Ctx,
  client: ClientConfig,
  query: Query,
  intervalMs: number,
  limit = 100,
): EventSource {
  return {
    poll: (start, delay): AsyncGenerator<PollResult> =>
      pollPages({
        ...client,
        ...query,
        fetch: ctx.fetch,
        signal: ctx.signal,
        sleep: ctx.sleep,
        after: start.sk,
        limit,
        intervalMs,
        ...(delay ? { delay } : {}),
      }),
  };
}
