import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Envelope, EventsPage } from "@hook-harness/protocol";

import { authorize } from "./auth.ts";
import { DAY_MS, eventPk, OVERLAP_MS, padMs, tokenAllowsOwner, tokenAllowsRepo } from "./keys.ts";
import { unpackPayload } from "./payload.ts";
import { fail, json } from "./respond.ts";
import type { Deps, UrlEvent, UrlResult } from "./types.ts";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
/** Function URL responses are capped at 6 MB; stop filling a page well before that. */
export const RESPONSE_BUDGET = 5_000_000;

function parseLimit(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return n >= 1 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
}

export async function handleEvents(event: UrlEvent, deps: Deps): Promise<UrlResult> {
  const scopes = await authorize(event, deps);
  if (!scopes) return fail(401, "unauthorized");
  const query = event.queryStringParameters ?? {};
  const owner = query["owner"];
  if (!owner) return fail(400, "owner is required");
  if (!tokenAllowsOwner(scopes, owner)) return fail(403, "forbidden");

  // `after` is a previous cursor (`<15-digit ms>#<id>`) or a bare epoch-ms start time.
  const after = query["after"];
  const afterDigits = after === undefined ? undefined : /^(\d{1,15})(?:#|$)/.exec(after)?.[1];
  if (after !== undefined && afterDigits === undefined) return fail(400, "invalid after");
  const wanted = query["repos"]?.toLowerCase().split(",");

  const retentionStart = deps.now() - DAY_MS;
  const afterMs = afterDigits === undefined ? undefined : Number(afterDigits);
  const lowerMs =
    afterMs === undefined ? retentionStart : Math.max(afterMs - OVERLAP_MS, retentionStart);
  const lower = padMs(lowerMs);
  const limit = parseLimit(query["limit"]);
  const withPayload = query["payload"] !== "0";

  const events: Envelope[] = [];
  let lastReturned: string | undefined;
  let lastScanned: string | undefined;
  let startKey: Record<string, unknown> | undefined;
  let bytes = 0;
  let filled = false;
  do {
    const page = await deps.db.send(
      new QueryCommand({
        TableName: deps.table,
        KeyConditionExpression: "PK = :pk AND SK > :lower",
        ExpressionAttributeValues: { ":pk": eventPk(owner), ":lower": lower },
        ScanIndexForward: true,
        Limit: limit,
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const repo = item["repo"] as string;
      lastScanned = item["SK"] as string;
      if (!tokenAllowsRepo(scopes, repo) || (wanted && !wanted.includes(repo.toLowerCase()))) {
        continue;
      }
      const envelope = toEnvelope(item, withPayload);
      const size = JSON.stringify(envelope).length;
      if (events.length > 0 && bytes + size > RESPONSE_BUDGET) {
        filled = true;
        break;
      }
      bytes += size;
      events.push(envelope);
      lastReturned = lastScanned;
      if (events.length === limit) filled = true;
      if (filled) break;
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey && !filled);

  // When the limit or size budget cut the scan short, resume right after the last returned
  // event; otherwise everything scanned (even if filtered out) is behind us.
  const body: EventsPage = {
    events,
    cursor: (filled ? lastReturned : lastScanned) ?? after ?? lower,
    gap: afterMs !== undefined && afterMs < retentionStart,
  };
  return json(200, body);
}

function toEnvelope(item: Record<string, unknown>, withPayload: boolean): Envelope {
  const envelope = JSON.parse(item["envelope"] as string) as Envelope;
  const stored = item["payload"] as Uint8Array | undefined;
  if (!stored) {
    const omitted = item["payloadOmitted"] as Envelope["payloadOmitted"];
    return omitted ? { ...envelope, payloadOmitted: omitted } : envelope;
  }
  return withPayload
    ? { ...envelope, payload: unpackPayload(stored) }
    : { ...envelope, payloadOmitted: "not_requested" };
}
