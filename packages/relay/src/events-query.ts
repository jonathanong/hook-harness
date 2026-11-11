import type { Envelope, EventFilter } from "@hook-harness/protocol";

import { unpackPayload } from "./payload.ts";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
/** More filters than this is a client bug, not a query. */
export const MAX_FILTERS = 50;

export function parseLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return n >= 1 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
}

/**
 * `filters` is a JSON array of EventFilter objects, OR'd like the client's. Missing or empty means
 * no filtering; `null` means malformed. Unknown fields are kept (and ignored by `matches`), so an
 * older relay over-returns to a newer client, which filters locally anyway.
 */
export function parseFilters(raw: string | undefined): EventFilter[] | undefined | null {
  if (raw === undefined || raw === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_FILTERS) return null;
  const isObject = (f: unknown) => typeof f === "object" && f !== null && !Array.isArray(f);
  if (!parsed.every(isObject)) return null;
  return parsed.length > 0 ? (parsed as EventFilter[]) : undefined;
}

export function parseEnvelope(item: Record<string, unknown>): Envelope {
  return JSON.parse(item["envelope"] as string) as Envelope;
}

export function withStoredPayload(
  envelope: Envelope,
  item: Record<string, unknown>,
  withPayload: boolean,
): Envelope {
  const stored = item["payload"] as Uint8Array | undefined;
  if (!stored) {
    const omitted = item["payloadOmitted"] as Envelope["payloadOmitted"];
    return omitted ? { ...envelope, payloadOmitted: omitted } : envelope;
  }
  return withPayload
    ? { ...envelope, payload: unpackPayload(stored) }
    : { ...envelope, payloadOmitted: "not_requested" };
}
