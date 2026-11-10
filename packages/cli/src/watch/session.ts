import { matches, type Envelope, type EventFilter } from "@hook-harness/protocol";

import { list, str, UsageError, type Values } from "../args.ts";
import { resolveClient } from "../client.ts";
import { parseDuration, parseSince } from "../duration.ts";
import type { Ctx } from "../types.ts";
import { decodeCursor, encodeCursor, type Cursor } from "./cursor.ts";
import { buildFilters } from "./flags.ts";
import { relaySource } from "./source.ts";
import { readCursor, writeCursor } from "./store.ts";
import type { EventSource } from "./types.ts";

export interface Session {
  source: EventSource;
  filters: EventFilter[];
  cursor: Cursor;
  intervalMs: number;
  settleMs: number;
  timeoutMs: number;
  /** Writes the cursor to the named state file when persistence applies. */
  save(cursor: Cursor): Promise<void>;
}

/** No filters means every event matches. */
export function matchesAny(filters: EventFilter[], event: Envelope): boolean {
  return filters.length === 0 || filters.some((filter) => matches(event, filter));
}

/** Precedence: `--after` > `--cursor` state file > `--since` > now. */
async function startCursor(values: Values, ctx: Ctx, name: string): Promise<Cursor> {
  const after = str(values, "after");
  if (after) return decodeCursor(after);
  const stored = await readCursor(ctx.env, name);
  if (stored) return decodeCursor(stored);
  const since = str(values, "since");
  const nowMs = ctx.now().getTime();
  return { sk: String(since ? parseSince(since, nowMs) : nowMs), seen: [] };
}

export async function openSession(
  values: Values,
  ctx: Ctx,
  timeoutDefault: string,
): Promise<Session> {
  const owner = str(values, "owner");
  if (!owner) throw new UsageError("--owner is required");
  const filters = buildFilters(values);
  const intervalMs = parseDuration(str(values, "interval") ?? "15s", "interval");
  const settleMs = parseDuration(str(values, "settle") ?? "10s", "settle", true);
  const timeoutMs = parseDuration(str(values, "timeout") ?? timeoutDefault, "timeout");
  const name = str(values, "cursor") ?? "default";
  const persist = !str(values, "after") || str(values, "cursor") !== undefined;
  const client = await resolveClient(ctx.env);
  const cursor = await startCursor(values, ctx, name);
  return {
    source: relaySource(
      ctx,
      client,
      { owner, repos: list(values, "repo"), payload: values["no-payload"] !== true },
      intervalMs,
    ),
    filters,
    cursor,
    intervalMs,
    settleMs,
    timeoutMs,
    save: async (next) => {
      if (persist) await writeCursor(ctx.env, name, encodeCursor(next));
    },
  };
}
