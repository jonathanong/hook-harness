import type { UrlResult } from "./types.ts";

export function status(statusCode: number): UrlResult {
  return { statusCode };
}

export function json(statusCode: number, value: unknown): UrlResult {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

export function fail(statusCode: number, error: string): UrlResult {
  return json(statusCode, { error });
}
