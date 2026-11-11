import { matches, type Envelope, type EventFilter } from "@hook-harness/protocol";

import { list, str, UsageError, type Values } from "../args.ts";
import { resolveClient } from "../client.ts";
import { parseDuration, parseSince } from "../duration.ts";
import type { Ctx } from "../types.ts";
import { decodeCursor, encodeCursor, type Cursor } from "./cursor.ts";
import { buildFilters, withRepos } from "./flags.ts";
import { relaySource } from "./source.ts";
import { sseSource } from "./sse-source.ts";
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

/** The encoded cursor if given, else `since` (ISO timestamp or duration), else now. */
export function startFrom(
  encoded: string | undefined,
  since: string | undefined,
  ctx: Ctx,
): Cursor {
  if (encoded) return decodeCursor(encoded);
  const nowMs = ctx.now().getTime();
  return { sk: String(since ? parseSince(since, nowMs) : nowMs), seen: [] };
}

/**
 * Precedence: `--after` > `--since` > `--cursor` state file > now. An explicit start point beats
 * the implicit state file, which another caller may have left behind.
 */
async function startCursor(values: Values, ctx: Ctx, name: string): Promise<Cursor> {
  const since = str(values, "since");
  const encoded = str(values, "after") || (since ? undefined : await readCursor(ctx.env, name));
  return startFrom(encoded, str(values, "since"), ctx);
}

/** The `--source` / `HOOK_HARNESS_SOURCE` URL; `serve` itself always polls the relay. */
function sourceUrl(values: Values, ctx: Ctx, relayOnly: boolean): string | undefined {
  const url = relayOnly
    ? undefined
    : (str(values, "source") ?? (ctx.env.HOOK_HARNESS_SOURCE || undefined));
  if (url === undefined) return undefined;
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (parsed?.protocol !== "http:" && parsed?.protocol !== "https:") {
    throw new UsageError(`invalid --source "${url}"; use an http(s) URL`);
  }
  return url;
}

export async function openSession(
  values: Values,
  ctx: Ctx,
  timeoutDefault: string,
  relayOnly = false,
): Promise<Session> {
  const url = sourceUrl(values, ctx, relayOnly);
  const owner = str(values, "owner") ?? "";
  // A `serve` source is already scoped to its own --owner.
  if (!owner && !url) throw new UsageError("--owner is required");
  // Through a `serve` the repo scope is a per-client filter rather than a relay query.
  const filters = url
    ? withRepos(buildFilters(values), list(values, "repo"))
    : buildFilters(values);
  const intervalMs = parseDuration(str(values, "interval") ?? "15s", "interval");
  const settleMs = parseDuration(str(values, "settle") ?? "10s", "settle", true);
  const timeoutMs = parseDuration(str(values, "timeout") ?? timeoutDefault, "timeout");
  const name = str(values, "cursor") ?? "default";
  const persist = !str(values, "after") || str(values, "cursor") !== undefined;
  const client = url ? undefined : await resolveClient(ctx.env);
  const cursor = await startCursor(values, ctx, name);
  const query = {
    owner,
    repos: list(values, "repo"),
    payload: values["no-payload"] !== true,
    // `serve` polls once for clients with different filters, so it must not narrow the relay.
    ...(relayOnly ? {} : { filters }),
  };
  const token = ctx.env.HOOK_HARNESS_SOURCE_TOKEN ?? "";
  return {
    source: client
      ? relaySource(ctx, client, query, intervalMs)
      : sseSource(ctx, { url: url!, token, filters, cursor, intervalMs }),
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
