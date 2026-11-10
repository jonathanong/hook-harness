import { createHash } from "node:crypto";
import {
  PutCommand,
  ScanCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

export interface TokenItem {
  PK: string;
  SK: "token";
  repos: string[];
  expiresAt: number;
  revoked: boolean;
  createdAt: string;
  label: string;
}

/** Same digest as `tokenHash` in the relay (asserted equal in tests). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function putToken(
  client: DynamoDBDocumentClient,
  table: string,
  item: TokenItem,
): Promise<void> {
  await client.send(
    new PutCommand({
      TableName: table,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK)",
    }),
  );
}

/** The table is tiny (events expire daily), so a filtered Scan is fine for listing tokens. */
export async function scanTokens(
  client: DynamoDBDocumentClient,
  table: string,
): Promise<TokenItem[]> {
  const items: TokenItem[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: "SK = :sk",
        ExpressionAttributeValues: { ":sk": "token" },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    items.push(...((page.Items ?? []) as TokenItem[]));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function markRevoked(
  client: DynamoDBDocumentClient,
  table: string,
  pk: string,
): Promise<void> {
  await client.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: pk, SK: "token" },
      UpdateExpression: "SET #r = :t",
      ConditionExpression: "attribute_exists(PK)",
      ExpressionAttributeNames: { "#r": "revoked" },
      ExpressionAttributeValues: { ":t": true },
    }),
  );
}
