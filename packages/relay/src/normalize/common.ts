import { emptyEnvelope, type Envelope } from "@hook-harness/protocol";

import type { Context, Payload } from "../types.ts";

export function stripHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

export function commitUrl(payload: Payload, sha: string): string {
  return `${payload.repository.html_url}/commit/${sha}`;
}

/** Envelope with the fields every event shares; callers pass the family-specific signals. */
export function build(
  event: string,
  payload: Payload,
  ctx: Context,
  fields: Partial<Envelope>,
): Envelope {
  return emptyEnvelope({
    id: ctx.id,
    receivedAt: ctx.receivedAt,
    event,
    repo: payload.repository.full_name,
    action: payload.action ?? null,
    sender: { login: payload.sender.login, type: payload.sender.type },
    ...fields,
  });
}
