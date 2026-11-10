import type { Envelope } from "@hook-harness/protocol";

import { encodeCursor, type Cursor } from "../watch/cursor.ts";

export interface Entry {
  event: Envelope;
  /** SSE `id`: an encoded cursor (relay page sort key plus this event's delivery id). */
  id: string;
  /** `receivedAt` in epoch ms. */
  ms: number;
  /** When this process buffered it, for age eviction. */
  at: number;
}

export interface BufferOptions {
  maxEvents: number;
  maxAgeMs: number;
  /** Nothing at or before this time is available (the daemon's own start point). */
  floorMs: number;
}

/** Recent events, bounded by count and age (whichever is smaller). */
export class RingBuffer {
  entries: Entry[] = [];
  #floorMs: number;
  readonly #options: BufferOptions;

  constructor(options: BufferOptions) {
    this.#options = options;
    this.#floorMs = options.floorMs;
  }

  get size(): number {
    return this.entries.length;
  }

  /** The id of the newest buffered event. */
  get head(): string | undefined {
    return this.entries.at(-1)?.id;
  }

  push(event: Envelope, sk: string, now: number): Entry {
    const entry: Entry = {
      event,
      id: encodeCursor({ sk, seen: [event.id] }),
      ms: Date.parse(event.receivedAt),
      at: now,
    };
    this.entries.push(entry);
    this.prune(now);
    return entry;
  }

  prune(now: number): void {
    let drop = Math.max(0, this.entries.length - this.#options.maxEvents);
    while (drop < this.entries.length && now - this.entries[drop]!.at > this.#options.maxAgeMs) {
      drop += 1;
    }
    for (const evicted of this.entries.splice(0, drop)) {
      this.#floorMs = Math.max(this.#floorMs, evicted.ms);
    }
  }

  /**
   * Entries after a client's position. Found by delivery id when possible, else by time. A
   * position before what the buffer can vouch for is a gap: the client may have missed events.
   */
  replay(cursor: Cursor): { gap: boolean; entries: Entry[] } {
    const known = new Set(cursor.seen);
    const index = this.entries.findLastIndex((entry) => known.has(entry.event.id));
    if (index !== -1) return { gap: false, entries: this.entries.slice(index + 1) };
    const at = Number.parseInt(cursor.sk, 10);
    if (Number.isNaN(at) || at < this.#floorMs) return { gap: true, entries: [] };
    return { gap: false, entries: this.entries.filter((entry) => entry.ms > at) };
  }
}
