import { createHmac } from "node:crypto";

import { mockClient } from "aws-sdk-client-mock";

import { db } from "../client.ts";

import { parsePayloadConfig } from "../payload.ts";
import type { Deps, UrlEvent } from "../types.ts";

export const NOW = Date.parse("2026-11-09T12:00:00.000Z");
export const SECRET = "s3cret";

export const ddb = mockClient(db);

export const deps: Deps = {
  db,
  table: "T",
  secret: SECRET,
  commands: ["/plan", "/fix", "/shepherd"],
  payload: parsePayloadConfig(undefined, undefined),
  now: () => NOW,
};

export function sign(body: string | Buffer, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function request(method: string, rawPath: string, extra: Partial<UrlEvent> = {}): UrlEvent {
  return {
    rawPath,
    headers: {},
    isBase64Encoded: false,
    requestContext: { http: { method } },
    ...extra,
  };
}

export function webhookEvent(
  name: string,
  payload: unknown,
  overrides: { base64?: boolean; signature?: string; headers?: UrlEvent["headers"] } = {},
): UrlEvent {
  const raw = Buffer.from(JSON.stringify(payload));
  return request("POST", "/webhook", {
    body: overrides.base64 ? raw.toString("base64") : raw.toString("utf8"),
    isBase64Encoded: overrides.base64 ?? false,
    headers: {
      "x-github-event": name,
      "x-github-delivery": "d-1",
      "x-hub-signature-256": overrides.signature ?? sign(raw),
      ...overrides.headers,
    },
  });
}
