import type { EventsPage } from "@hook-harness/protocol";

import type { ClientConfig } from "../client.ts";
import { withSlash } from "../commands/common.ts";
import type { Ctx } from "../types.ts";
import type { EventSource, PollResult } from "./types.ts";

/** 401/403 from the relay: retrying cannot help. */
export class AuthError extends Error {}

export interface Query {
  owner: string;
  repos: string[];
}

const MAX_BACKOFF_MS = 5 * 60_000;

async function fetchPage(
  ctx: Ctx,
  client: ClientConfig,
  query: Query,
  after: string,
  limit: number,
): Promise<EventsPage> {
  const params = new URLSearchParams({ owner: query.owner });
  if (query.repos.length > 0) params.set("repos", query.repos.join(","));
  params.set("after", after);
  params.set("limit", String(limit));
  const response = await ctx.fetch(`${withSlash(client.url)}events?${params}`, {
    headers: { authorization: `Bearer ${client.token}` },
    signal: ctx.signal,
  });
  if (response.status === 401 || response.status === 403) {
    throw new AuthError(
      `relay rejected the token (HTTP ${response.status}); run hook-harness login`,
    );
  }
  if (!response.ok) throw new Error(`relay returned HTTP ${response.status}`);
  return (await response.json()) as EventsPage;
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
    async *poll(startSk, delay): AsyncGenerator<PollResult> {
      let after = startSk;
      let failures = 0;
      while (!ctx.signal.aborted) {
        let wait: number | undefined;
        let result: PollResult;
        try {
          const page = await fetchPage(ctx, client, query, after, limit);
          failures = 0;
          after = page.cursor;
          result = { page };
          wait = page.events.length >= limit ? 0 : undefined;
        } catch (error) {
          if (error instanceof AuthError) throw error;
          failures += 1;
          result = { error: error as Error };
          wait = Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS);
        }
        yield result;
        // Asked after the consumer handled the result, so it can shorten the sleep.
        await ctx.sleep(wait ?? delay(), ctx.signal);
      }
    },
  };
}
