import { setTimeout } from "node:timers/promises";

import { matches, type Envelope, type EventsPage } from "@hook-harness/protocol";

import {
  advance,
  decodeCursor,
  encodeCursor,
  forOwners,
  type Cursor,
  type Position,
} from "../watch/cursor.ts";
import { AuthError, BadRequestError } from "./errors.ts";
import {
  backoffMs,
  eventsUrl,
  fetchEventsPage,
  queryFilters,
  type Connection,
  type EventsQuery,
} from "./events.ts";
import { merge } from "./merge.ts";

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
 * once; other failures are yielded and retried with capped exponential backoff. `AuthError` and
 * `BadRequestError` throw, since retrying cannot help.
 * Pages are as the relay sent them: see `pollEvents` for deduplicated, filtered events.
 */
export async function* pollPages(options: PollPagesOptions): AsyncGenerator<PageResult> {
  const { limit = 100, intervalMs = 5000, sleep = defaultSleep } = options;
  const signal = options.signal ?? new AbortController().signal;
  eventsUrl(options.url); // Throws now rather than being retried as a request failure.
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
      // Stopped on purpose: the aborted fetch is not a failure to report.
      if (signal.aborted) return;
      if (error instanceof AuthError || error instanceof BadRequestError) throw error;
      failures += 1;
      result = { error: error as Error };
      wait = backoffMs(intervalMs, failures);
    }
    yield result;
    // Asked after the consumer handled the result, so it can shorten the sleep.
    await sleep(wait ?? options.delay?.() ?? intervalMs, signal);
  }
}

export interface PollEventsOptions extends Omit<PollPagesOptions, "after" | "owner"> {
  /** One owner, or several polled side by side under one cursor (like `wait --owner a,b`). */
  owner: string | string[];
  /** A `cursor` from an earlier batch, or one printed by `hook-harness wait`/`tail`. */
  after?: string;
  /** Start time when there is no `after` (and for owners `after` lacks); absent means now. */
  since?: Date;
}

/** One owner's poll: its new matching events and the cursor to resume every owner from. */
export type EventsBatch = { owner: string } & (
  | {
      events: Envelope[];
      /** Pass as `after` to resume; the same format `hook-harness wait --after` takes. */
      cursor: string;
      /** True when `owner`'s start point is older than the relay's 24h retention. */
      gap: boolean;
    }
  | { error: Error }
);

async function* tagged(
  owner: string,
  poll: AsyncGenerator<PageResult>,
): AsyncGenerator<PageResult & { owner: string }> {
  for await (const result of poll) yield { ...result, owner };
}

/**
 * Polls each owner like `pollPages`, but yields each event once (the relay's overlap replay is
 * dropped) and only events matching `filters`/`on`, so it is exact even when filters are too big
 * to send. Yields a batch for every poll, empty or not, naming the owner it came from; with
 * several owners, `cursor` covers them all. Throws `InvalidCursorError` for a bad `after` and `TypeError` for an unknown preset.
 */
export async function* pollEvents(options: PollEventsOptions): AsyncGenerator<EventsBatch> {
  const filters = queryFilters(options);
  const owners = [...new Set([options.owner].flat().map((owner) => owner.toLowerCase()))];
  if (owners.length === 0) throw new TypeError("owner is required");
  const fresh = (): Position => ({ sk: String((options.since ?? new Date()).getTime()), seen: [] });
  const after = options.after === undefined ? fresh() : decodeCursor(options.after);
  let cursor: Cursor = forOwners(after, owners, fresh);
  // Stops every owner's poll (and its sleep) once the consumer is done or one poll throws.
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, ...(options.signal ? [options.signal] : [])]);
  const polls = owners.map((owner) =>
    tagged(
      owner,
      pollPages({ ...options, owner, signal, after: (cursor.owners?.[owner] ?? cursor).sk }),
    ),
  );
  try {
    for await (const result of merge(polls)) {
      if ("error" in result) {
        yield result;
        continue;
      }
      const step = advance(cursor, result.page, result.owner);
      cursor = step.next;
      const events = step.fresh.filter(
        (event: Envelope) => filters.length === 0 || filters.some((f) => matches(event, f)),
      );
      yield { owner: result.owner, events, cursor: encodeCursor(cursor), gap: result.page.gap };
    }
  } finally {
    stop.abort();
  }
}
