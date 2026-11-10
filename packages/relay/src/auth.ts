import { GetCommand } from "@aws-sdk/lib-dynamodb";

import { tokenKey } from "./keys.ts";
import type { Deps, UrlEvent } from "./types.ts";

/** Repos a valid bearer token may read, or null when the token is missing, revoked or expired. */
export async function authorize(event: UrlEvent, deps: Deps): Promise<string[] | null> {
  const token = /^Bearer (\S+)$/i.exec(event.headers["authorization"] ?? "")?.[1];
  if (!token) return null;
  const { Item } = await deps.db.send(
    new GetCommand({ TableName: deps.table, Key: tokenKey(token) }),
  );
  if (!Item || Item["revoked"] === true) return null;
  if (typeof Item["expiresAt"] !== "number" || Item["expiresAt"] <= deps.now() / 1000) return null;
  return Item["repos"] as string[];
}
