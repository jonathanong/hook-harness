import type { EventsPage } from "@hook-harness/protocol";

/** One poll: a page of events, or the error that poll hit (retried by the source). */
export type PollResult = { page: EventsPage } | { error: Error };

/**
 * Where `wait` and `tail` get batches from. The relay poller is one implementation; a local
 * `serve` fan-out can be another without touching filter, settle, or cursor logic.
 * `delay()` is asked for the sleep before each next poll so callers can shorten it.
 */
export interface EventSource {
  poll(startSk: string, delay: () => number): AsyncGenerator<PollResult>;
}
