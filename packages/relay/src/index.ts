import { db } from "./client.ts";
import { route } from "./handler.ts";
import { parsePayloadConfig } from "./payload.ts";
import type { UrlEvent, UrlResult } from "./types.ts";

export function handler(event: UrlEvent): Promise<UrlResult> {
  return route(event, {
    db,
    table: process.env["TABLE_NAME"] as string,
    secret: process.env["WEBHOOK_SECRET"],
    payload: parsePayloadConfig(process.env["PAYLOAD_DROP"], process.env["PAYLOAD_MAX_BYTES"]),
    now: Date.now,
  });
}
