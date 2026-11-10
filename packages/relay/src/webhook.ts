import { PutCommand } from "@aws-sdk/lib-dynamodb";

import { eventExpiresAt, eventPk, eventSk } from "./keys.ts";
import { normalizers } from "./normalize/index.ts";
import { fail, status } from "./respond.ts";
import { verifySignature } from "./signature.ts";
import type { Deps, UrlEvent, UrlResult } from "./types.ts";

function rawBody(event: UrlEvent): Buffer {
  const body = event.body ?? "";
  return Buffer.from(body, event.isBase64Encoded ? "base64" : "utf8");
}

export async function handleWebhook(event: UrlEvent, deps: Deps): Promise<UrlResult> {
  const body = rawBody(event);
  if (!verifySignature(deps.secret, body, event.headers["x-hub-signature-256"])) {
    return fail(401, "invalid signature");
  }
  const name = event.headers["x-github-event"];
  const id = event.headers["x-github-delivery"];
  if (!name || !id) return fail(400, "missing headers");
  if (name === "ping") return status(200);

  const normalize = normalizers.get(name);
  if (!normalize) return status(202);
  const receivedMs = deps.now();
  const envelope = normalize(JSON.parse(body.toString("utf8")), {
    id,
    receivedAt: new Date(receivedMs).toISOString(),
    commands: deps.commands,
  });
  if (!envelope) return status(202);

  try {
    await deps.db.send(
      new PutCommand({
        TableName: deps.table,
        Item: {
          PK: eventPk(envelope.repo.split("/")[0] as string),
          SK: eventSk(receivedMs, id),
          repo: envelope.repo,
          envelope: JSON.stringify(envelope),
          expiresAt: eventExpiresAt(receivedMs),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (error) {
    // A redelivery of an already stored event is a success.
    if ((error as Error).name !== "ConditionalCheckFailedException") throw error;
  }
  return status(202);
}
