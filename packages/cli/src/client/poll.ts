import { setTimeout } from "node:timers/promises";

import { matches, type Envelope, type EventsPage } from "@hook-harness/protocol";

import { advance, decodeCursor, encodeCursor, forOwners, type Position } from "../watch/cursor.ts";
import { AuthError } from "./errors.ts";
import {
  backoffMs,
  fetchEventsPage,
  queryFilters,
  type Connection,
  type EventsQuery,
} from "./events.ts";

/** One poll: a page, or the error it hit (retried after a backoff). */
export type PageResult = { page: EventsPage } | { error: Error };

export interface PollPagesOptions extends Connection, EventsQuery {
  /** Relay cursor (or epoch ms) to start after. */
  after: string;
  /** Events per page (default 100). */
  limit?: number;
  /** Sleep between polls when caught up, and the backoff base (default 5000). */
  intervalMs?: number;
  /** Asked for the sleep before each next poll, after the consumer handled the last result. */
  delay?: () => number;
  /** Resolves after `ms`, or early when `signal` aborts. Must not reject. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  setTimeout(ms, undefined, { signal }).catch(() => undefined);

/**
 * Polls `GET /events` until `signal` aborts. A page that was cut short (`more`) is followed up at
 * once; other failures are yielded and retried with capped exponential backoff. Auth errors throw.
 * Pages are as the relay sent them: see `pollEvents` for deduplicated, filtered events.
 */
export async function* pollPages(options: PollPagesOptions): AsyncGenerator<PageResult> {
  const { limit = 100, intervalMs = 5000, sleep = defaultSleep } = options;
  const signal = options.signal ?? new AbortController().signal;
  let after = options.after;
  let failures = 0;
  while (!signal.aborted) {
    let wait: number | undefined;
    let result: PageResult;
    try {
      const page = await fetchEventsPage({ ...options, after, limit });
      failures = 0;
      after = page.cursor;
      result = { page };
      wait = (page.more ?? page.events.length >= limit) ? 0 : undefined;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      failures += 1;
      result = { error: error as Error };
      wait = backoffMs(intervalMs, failures);
    }
    yield result;
    // Asked after the consumer handled the result, so it can shorten the sleep.
    await sleep(wait ?? options.delay?.() ?? intervalMs, signal);
  }
}

export interface PollEventsOptions extends Omit<PollPagesOptions, "after"> {
  /** A `cursor` from an earlier batch, or one printed by `hook-harness wait`/`tail`. */
  after?: string;
  /** Start time when there is no `after`; absent means now. */
  since?: Date;
}

/** New matching events since the last batch, and the cursor to resume after them. */
export type EventsBatch =
  | {
      events: Envelope[];
      /** Pass as `after` to resume; the same format `hook-harness wait --after` takes. */
      cursor: string;
      /** True when the start point is older than the relay's 24h retention. */
      gap: boolean;
    }
  | { error: Error };

function start(options: PollEventsOptions): Position {
  const fresh = (): Position => ({ sk: String((options.since ?? new Date()).getTime()), seen: [] });
  if (options.after === undefined) return fresh();
  return forOwners(decodeCursor(options.after), [options.owner.toLowerCase()], fresh);
}

/**
 * Polls like `pollPages`, but yields each event once (the relay's overlap replay is dropped) and
 * only events matching `filters`/`on`, so it is exact even when filters are too big to send.
 * Yields a batch for every poll, empty or not. Throws for a bad `after` or an unknown preset.
 */
export async function* pollEvents(options: PollEventsOptions): AsyncGenerator<EventsBatch> {
  const filters = queryFilters(options);
  let cursor = start(options);
  for await (const result of pollPages({ ...options, after: cursor.sk })) {
    if ("error" in result) {
      yield result;
      continue;
    }
    const step = advance(cursor, result.page);
    cursor = step.next;
    const events = step.fresh.filter(
      (event: Envelope) => filters.length === 0 || filters.some((f) => matches(event, f)),
    );
    yield { events, cursor: encodeCursor(cursor), gap: result.page.gap };
  }
}
