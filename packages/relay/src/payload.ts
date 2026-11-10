import { gunzipSync, gzipSync } from "node:zlib";

import type { Payload } from "./types.ts";

/** Top-level payload keys that are never stored. */
export const ALWAYS_DROP = ["installation"];
/** Large objects repeated on every delivery, dropped unless `PAYLOAD_DROP` says otherwise. */
export const DEFAULT_DROP = "repository,organization";
export const DEFAULT_MAX_BYTES = 1_000_000;
/** DynamoDB items are capped at 400 KB; leave room for the other attributes. */
export const MAX_STORED_BYTES = 350_000;

export interface PayloadConfig {
  drop: string[];
  /** Largest pruned payload (uncompressed JSON bytes) to store; 0 disables payloads. */
  maxBytes: number;
}

export function parsePayloadConfig(drop: string | undefined, maxBytes: string | undefined) {
  const keys = (drop ?? DEFAULT_DROP)
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const n = Number.parseInt(maxBytes ?? "", 10);
  return {
    drop: [...new Set([...ALWAYS_DROP, ...keys])],
    maxBytes: n >= 0 ? n : DEFAULT_MAX_BYTES,
  } satisfies PayloadConfig;
}

export type Packed = { payload: Uint8Array } | { payloadOmitted: "disabled" | "too_large" };

/** Prunes and gzips a payload for storage, or says why it was left out. */
export function packPayload(payload: Payload, config: PayloadConfig): Packed {
  if (config.maxBytes === 0) return { payloadOmitted: "disabled" };
  const pruned = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !config.drop.includes(key)),
  );
  const json = Buffer.from(JSON.stringify(pruned));
  if (json.length > config.maxBytes) return { payloadOmitted: "too_large" };
  const gz = gzipSync(json);
  return gz.length > MAX_STORED_BYTES ? { payloadOmitted: "too_large" } : { payload: gz };
}

export function unpackPayload(gz: Uint8Array): Payload {
  return JSON.parse(gunzipSync(gz).toString("utf8")) as Payload;
}
