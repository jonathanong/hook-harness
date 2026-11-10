import { PutCommand } from "@aws-sdk/lib-dynamodb";

import { eventExpiresAt, eventPk, eventSk } from "./keys.ts";
import { normalizers } from "./normalize/index.ts";
import { packPayload } from "./payload.ts";
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
  const payload = JSON.parse(body.toString("utf8"));
  const envelope = normalize(payload, {
    id,
    receivedAt: new Date(receivedMs).toISOString(),
    commands: deps.commands,
  });
  if (!envelope) return status(202);

  // GitHub never retries on its own; a manual redelivery gets a new sort key and is
  // replayed to pollers on purpose. Clients dedupe by delivery id only within the overlap.
  await deps.db.send(
    new PutCommand({
      TableName: deps.table,
      Item: {
        PK: eventPk(envelope.repo.split("/")[0] as string),
        SK: eventSk(receivedMs, id),
        repo: envelope.repo,
        envelope: JSON.stringify(envelope),
        expiresAt: eventExpiresAt(receivedMs),
        ...packPayload(payload, deps.payload),
      },
    }),
  );
  return status(202);
}
