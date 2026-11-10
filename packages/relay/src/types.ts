import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Envelope } from "@hook-harness/protocol";

import type { PayloadConfig } from "./payload.ts";

/** Subset of the Lambda function URL event (payload format 2.0) the relay reads. */
export interface UrlEvent {
  rawPath: string;
  headers: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded: boolean;
  requestContext: { http: { method: string } };
}

export interface UrlResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

/** Parsed webhook payload. Only the fields each normalizer reads are touched. */
// oxlint-disable-next-line typescript/no-explicit-any
export type Payload = Record<string, any>;

export interface Context {
  id: string;
  receivedAt: string;
}

export interface Deps {
  db: DynamoDBDocumentClient;
  table: string;
  secret: string | undefined;
  payload: PayloadConfig;
  /** Clock in epoch milliseconds. */
  now: () => number;
}

export type Normalizer = (payload: Payload, ctx: Context) => Envelope;
