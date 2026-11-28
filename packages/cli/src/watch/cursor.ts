import type { Envelope, EventsPage } from "@hook-harness/protocol";

import { InvalidCursorError } from "../client/errors.ts";

/** One relay stream's resume point: sort key plus delivery IDs inside the relay's overlap. */
export interface Position {
  sk: string;
  seen: string[];
}

/**
 * Self-contained resume point. With several owners, `owners` holds one position per lowercased
 * owner, and `sk`/`seen` summarize them (earliest sort key, every seen ID).
 */
export interface Cursor extends Position {
  owners?: Record<string, Position>;
}

// Covers a page of replayed overlap plus a full page (relay MAX_LIMIT is 500).
const MAX_SEEN = 1000;
/** The relay re-returns 60s before `after`; keep a margin. */
const WINDOW_MS = 90_000;

const INVALID = "invalid cursor: pass the `cursor` value printed by a previous wait/tail";

/** Sort keys are epoch ms, optionally zero-padded and followed by `#<id>`. */
const skMs = (sk: string): number => Number.parseInt(sk, 10);

/** A cursor over several owners; its summary `sk` is the earliest owner's. */
export function combine(owners: Record<string, Position>): Cursor {
  const positions = Object.values(owners);
  const earliest = positions.reduce((a, b) => (skMs(b.sk) < skMs(a.sk) ? b : a));
  return { sk: earliest.sk, seen: positions.flatMap((p) => p.seen), owners };
}

/**
 * The cursor for exactly these owners. A single-owner cursor applies to every owner; an owner a
 * multi-owner cursor lacks starts at `fallback()`; owners not asked for are dropped.
 */
export function forOwners(cursor: Cursor, owners: string[], fallback: () => Position): Cursor {
  const pick = (owner: string): Position => {
    if (!cursor.owners) return { sk: cursor.sk, seen: cursor.seen };
    return Object.hasOwn(cursor.owners, owner) ? cursor.owners[owner]! : fallback();
  };
  if (owners.length === 1) return pick(owners[0]!);
  return combine(Object.fromEntries(owners.map((owner) => [owner, pick(owner)])));
}

export function encodeCursor(cursor: Cursor): string {
  const data = cursor.owners
    ? { v: 2, owners: cursor.owners }
    : { v: 1, sk: cursor.sk, seen: cursor.seen };
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function isPosition(value: unknown): value is Position {
  const p = value as Partial<Position> | null;
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.sk === "string" &&
    Array.isArray(p.seen) &&
    p.seen.every((id) => typeof id === "string")
  );
}

export function decodeCursor(text: string): Cursor {
  let data: { v?: unknown; sk?: unknown; seen?: unknown; owners?: unknown } | null | undefined;
  try {
    data = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    data = undefined;
  }
  if (data?.v === 1 && isPosition(data)) return { sk: data.sk, seen: data.seen };
  const owners = data?.v === 2 ? data.owners : undefined;
  if (
    typeof owners === "object" &&
    owners !== null &&
    Object.keys(owners).length > 1 &&
    Object.values(owners).every(isPosition)
  ) {
    return combine(owners as Record<string, Position>);
  }
  throw new InvalidCursorError(INVALID);
}

function step(position: Position, page: EventsPage): { fresh: Envelope[]; next: Position } {
  const known = new Set(position.seen);
  const fresh = page.events.filter((event) => !known.has(event.id));
  if (page.events.length === 0) return { fresh, next: { sk: page.cursor, seen: position.seen } };
  const times = page.events.map((event) => Date.parse(event.receivedAt));
  const newest = Math.max(...times);
  const seen = page.events
    .filter((_, index) => times[index]! >= newest - WINDOW_MS)
    .map((event) => event.id)
    .slice(-MAX_SEEN);
  return { fresh, next: { sk: page.cursor, seen } };
}

/**
 * Drops already-delivered events and computes the cursor to resume from. `owner` names the
 * owner whose stream the page came from when the cursor covers several.
 */
export function advance(
  cursor: Cursor,
  page: EventsPage,
  owner?: string,
): { fresh: Envelope[]; next: Cursor } {
  const position =
    owner && cursor.owners && Object.hasOwn(cursor.owners, owner)
      ? cursor.owners[owner]
      : undefined;
  if (!position) return step(cursor, page);
  const { fresh, next } = step(position, page);
  return { fresh, next: combine({ ...cursor.owners, [owner!]: next }) };
}
