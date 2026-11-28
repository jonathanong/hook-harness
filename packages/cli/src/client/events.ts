import { preset, type EventFilter, type EventsPage } from "@hook-harness/protocol";

import { BadRequestError, OutOfScopeError, RelayError, UnauthorizedError } from "./errors.ts";

/** Where the relay is and how to reach it. */
export interface Connection {
  /** The relay's function URL (or a `serve` URL that proxies it). */
  url: string;
  /** An `hh_...` token. */
  token: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/** What to read: one owner's events, optionally narrowed. */
export interface EventsQuery {
  owner: string;
  /** `owner/name` values; empty or absent means every repo the token covers. */
  repos?: string[];
  /** An event matches when it matches any filter (or `on` preset). */
  filters?: EventFilter[];
  /** Preset names, as `--on` takes them: `ejection`, `/shepherd`, `label:<name>`, ... */
  on?: string[];
  /** Include the webhook payload (default true). */
  payload?: boolean;
}

export interface FetchEventsPageOptions extends Connection, EventsQuery {
  /** A previous page's `cursor`. Wins over `since`. */
  after?: string;
  /** Start time when there is no `after`; absent means the start of retention (24h). */
  since?: Date;
  /** Events per page; the relay caps it. */
  limit?: number;
}

const MAX_BACKOFF_MS = 5 * 60_000;
/** The relay rejects more than 50 filters; past these limits only local filtering applies. */
const MAX_RELAY_FILTERS = 50;
const MAX_FILTERS_JSON = 4000;

/** The `filters` param, or undefined when there are none or they are too big to send. */
export function relayFilters(filters: EventFilter[] | undefined): string | undefined {
  if (!filters?.length || filters.length > MAX_RELAY_FILTERS) return undefined;
  const json = JSON.stringify(filters);
  return json.length <= MAX_FILTERS_JSON ? json : undefined;
}

/** Capped exponential backoff shared by every source. */
export function backoffMs(intervalMs: number, failures: number): number {
  return Math.min(intervalMs * 2 ** failures, MAX_BACKOFF_MS);
}

/** `filters` plus the `on` presets. Throws `TypeError` for an unknown preset. */
export function queryFilters(query: Pick<EventsQuery, "filters" | "on">): EventFilter[] {
  const presets = (query.on ?? []).map((name) => {
    const found = preset(name);
    if (!found) throw new TypeError(`unknown preset "${name}"`);
    return found;
  });
  return [...(query.filters ?? []), ...presets];
}

/**
 * The relay's only 403 is a valid token whose repo scope lists nothing under the owner. Newer
 * relays name the token's scopes in the body; older ones do not.
 */
async function outOfScope(response: Response, owner: string): Promise<OutOfScopeError> {
  const body = (await response.json().catch(() => undefined)) as { scopes?: unknown } | undefined;
  const scopes = Array.isArray(body?.scopes) ? body.scopes.map(String) : undefined;
  const listed = scopes ? ` (it has ${scopes.join(", ")})` : "";
  const repos = [...(scopes ?? ["<current repos>"]), `${owner}/*`].join(",");
  const message =
    `the token's repo scope does not cover owner "${owner}"${listed} (HTTP 403); ` +
    `create one that does with hook-harness token create --login --repos '${repos}'`;
  return new OutOfScopeError(message, owner, scopes);
}

/** The relay names what it rejected (`invalid after`, `invalid filters`, ...) in `error`. */
async function badRequest(response: Response): Promise<BadRequestError> {
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  const reason = typeof body?.error === "string" ? `: ${body.error}` : "";
  return new BadRequestError(400, `relay rejected the request (HTTP 400)${reason}`);
}

/**
 * One `GET /events` request. Returns the page exactly as the relay sent it: the relay replays
 * the last 60 seconds before `after`, so events can repeat across pages, and filters too many or
 * too long to send are not applied. `pollEvents` handles both.
 */
export async function fetchEventsPage(options: FetchEventsPageOptions): Promise<EventsPage> {
  const params = new URLSearchParams({ owner: options.owner });
  if (options.repos?.length) params.set("repos", options.repos.join(","));
  const after = options.after ?? (options.since ? String(options.since.getTime()) : undefined);
  if (after !== undefined) params.set("after", after);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.payload === false) params.set("payload", "0");
  const filters = relayFilters(queryFilters(options));
  if (filters) params.set("filters", filters);
  const base = options.url.endsWith("/") ? options.url : `${options.url}/`;
  const response = await (options.fetch ?? fetch)(`${base}events?${params}`, {
    headers: { authorization: `Bearer ${options.token}` },
    signal: options.signal ?? null,
  });
  if (response.status === 401) {
    throw new UnauthorizedError("relay rejected the token (HTTP 401); run hook-harness login");
  }
  if (response.status === 403) throw await outOfScope(response, options.owner);
  if (response.status === 400) throw await badRequest(response);
  if (!response.ok) throw new RelayError(response.status);
  return (await response.json()) as EventsPage;
}
