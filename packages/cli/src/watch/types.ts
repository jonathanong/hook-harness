import type { EventsPage } from "@hook-harness/protocol";

import type { Cursor } from "./cursor.ts";

/**
 * One poll: a page of events, or the error that poll hit (retried by the source). `owner` is
 * set when the source reads several owners, naming the one this result came from.
 */
export type PollResult = ({ page: EventsPage } | { error: Error }) & { owner?: string };

/**
 * Where `wait` and `tail` get batches from. The relay poller is one implementation; a local
 * `serve` fan-out can be another without touching filter, settle, or cursor logic.
 * `delay()` is asked for the sleep before each next poll so callers can shorten it; without one
 * the source sleeps its interval.
 */
export interface EventSource {
  poll(start: Cursor, delay?: () => number): AsyncGenerator<PollResult>;
}
