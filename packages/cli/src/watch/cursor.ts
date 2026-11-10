import type { Envelope, EventsPage } from "@hook-harness/protocol";

/** Self-contained resume point: relay sort key plus delivery IDs inside the relay's overlap. */
export interface Cursor {
  sk: string;
  seen: string[];
}

// Covers a page of replayed overlap plus a full page (relay MAX_LIMIT is 500).
const MAX_SEEN = 1000;
/** The relay re-returns 60s before `after`; keep a margin. */
const WINDOW_MS = 90_000;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ v: 1, sk: cursor.sk, seen: cursor.seen })).toString(
    "base64url",
  );
}

export function decodeCursor(text: string): Cursor {
  let data: { v?: unknown; sk?: unknown; seen?: unknown } | null | undefined;
  try {
    data = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    data = undefined;
  }
  if (
    !data ||
    data.v !== 1 ||
    typeof data.sk !== "string" ||
    !Array.isArray(data.seen) ||
    !data.seen.every((id) => typeof id === "string")
  ) {
    throw new Error("invalid cursor: pass the `cursor` value printed by a previous wait/tail");
  }
  return { sk: data.sk, seen: data.seen as string[] };
}

/** Drops already-delivered events and computes the cursor to resume from. */
export function advance(cursor: Cursor, page: EventsPage): { fresh: Envelope[]; next: Cursor } {
  const known = new Set(cursor.seen);
  const fresh = page.events.filter((event) => !known.has(event.id));
  if (page.events.length === 0) return { fresh, next: { sk: page.cursor, seen: cursor.seen } };
  const times = page.events.map((event) => Date.parse(event.receivedAt));
  const newest = Math.max(...times);
  const seen = page.events
    .filter((_, index) => times[index]! >= newest - WINDOW_MS)
    .map((event) => event.id)
    .slice(-MAX_SEEN);
  return { fresh, next: { sk: page.cursor, seen } };
}
