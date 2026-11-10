import type { Envelope, EventFilter } from "@hook-harness/protocol";

import type { Ctx } from "../types.ts";
import { decodeCursor, encodeCursor, type Cursor } from "./cursor.ts";
import { createSseParser, type SseItem } from "./sse-parser.ts";
import { AuthError, backoffMs } from "./source.ts";
import type { EventSource, PollResult } from "./types.ts";

export interface SseOptions {
  /** Base URL of a running `hook-harness serve`. */
  url: string;
  /** Bearer token for `serve --auth-token`; empty means none. */
  token: string;
  filters: EventFilter[];
  /** Where to resume; sent as `Last-Event-ID` on the first connect. */
  cursor: Cursor;
  intervalMs: number;
}

function skOf(text: string): string | undefined {
  try {
    return decodeCursor(text).sk;
  } catch {
    return undefined;
  }
}

export function eventsUrl(base: string, filters: EventFilter[]): string {
  const url = new URL("events", base.endsWith("/") ? base : `${base}/`);
  for (const filter of filters) url.searchParams.append("filter", JSON.stringify(filter));
  return url.href;
}

interface Taken {
  id: string | undefined;
  event?: Envelope;
  gap: boolean;
}

function take(item: SseItem): Taken {
  if (item.type === "comment") return { id: undefined, gap: false };
  if (item.event === "envelope") {
    return { id: item.id, event: JSON.parse(item.data) as Envelope, gap: false };
  }
  if (item.event === "gap") {
    return { id: (JSON.parse(item.data) as { cursor?: string }).cursor, gap: true };
  }
  return { id: undefined, gap: false };
}

/**
 * Reads a local `serve` over SSE. Each network chunk becomes one page; heartbeats become empty
 * pages so `wait` can still observe its timeout. A dropped stream is an error result, retried
 * with the relay's backoff and resumed from the last `id` received.
 */
export function sseSource(ctx: Ctx, options: SseOptions): EventSource {
  return {
    async *poll(startSk): AsyncGenerator<PollResult> {
      let sk = startSk;
      let lastId = encodeCursor(options.cursor);
      let failures = 0;
      while (!ctx.signal.aborted) {
        try {
          const headers: Record<string, string> = {
            accept: "text/event-stream",
            "last-event-id": lastId,
          };
          if (options.token) headers.authorization = `Bearer ${options.token}`;
          const response = await ctx.fetch(eventsUrl(options.url, options.filters), {
            headers,
            signal: ctx.signal,
          });
          if (response.status === 401 || response.status === 403) {
            throw new AuthError(`serve rejected the token (HTTP ${response.status})`);
          }
          if (!response.ok || !response.body) {
            throw new Error(`serve returned HTTP ${response.status}`);
          }
          failures = 0;
          const parser = createSseParser();
          const decoder = new TextDecoder();
          for await (const chunk of response.body) {
            const events: Envelope[] = [];
            let gap = false;
            for (const item of parser.push(decoder.decode(chunk, { stream: true }))) {
              const taken = take(item);
              const idSk = taken.id ? skOf(taken.id) : undefined;
              if (taken.id && idSk) {
                lastId = taken.id;
                sk = idSk;
              }
              if (taken.event) events.push(taken.event);
              gap ||= taken.gap;
            }
            yield { page: { events, cursor: sk, gap } };
          }
          throw new Error("serve closed the stream");
        } catch (error) {
          if (ctx.signal.aborted) return;
          if (error instanceof AuthError) throw error;
          failures += 1;
          yield { error: error as Error };
          await ctx.sleep(backoffMs(options.intervalMs, failures), ctx.signal);
        }
      }
    },
  };
}
