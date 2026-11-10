import { emptyEnvelope, type Envelope } from "@hook-harness/protocol";

import type { Context, Normalizer, Payload } from "../types.ts";

export function stripHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

export function commitUrl(payload: Payload, sha: string): string {
  return `${payload.repository.html_url}/commit/${sha}`;
}

const COMMAND = /^\/[a-z0-9][a-z0-9_-]*$/;

/** First whitespace-delimited token of a comment body when it looks like a slash command. */
export function commandOf(body: string | null | undefined): string | null {
  const token = (body ?? "").trimStart().split(/\s/, 1)[0]!.toLowerCase();
  return COMMAND.test(token) ? token : null;
}

/** Login and type of a comment or review author; null when GitHub has no user (ghost). */
export function authorOf(user: { login: string; type: string } | null | undefined) {
  return user ? { login: user.login, type: user.type } : null;
}

/** Owning account: the repo owner, else the org, else the installation account. */
export function ownerOf(payload: Payload): string | null {
  return (
    payload.repository?.owner?.login ??
    payload.repository?.full_name?.split("/")[0] ??
    payload.organization?.login ??
    payload.installation?.account?.login ??
    null
  );
}

/** Label and requested-reviewer signals, set only when the payload carries them. */
function targets(payload: Payload): Partial<Envelope> {
  const label: string | undefined = payload.label?.name;
  const reviewer: string | undefined =
    payload.requested_reviewer?.login ?? payload.requested_team?.slug;
  return {
    ...(label !== undefined && { label }),
    ...(reviewer !== undefined && { requestedReviewer: reviewer }),
  };
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
    owner: ownerOf(payload) as string,
    repo: payload.repository?.full_name ?? null,
    action: payload.action ?? null,
    sender: authorOf(payload.sender),
    ...targets(payload),
    ...fields,
  });
}

/** Fallback for events without a dedicated normalizer; the payload carries the details. */
export function generic(event: string): Normalizer {
  return (payload, ctx) => build(event, payload, ctx, {});
}
