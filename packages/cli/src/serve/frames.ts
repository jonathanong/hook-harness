import type { Entry } from "./buffer.ts";

/** SSE comment used as a heartbeat; ignored by EventSource clients. */
export const PING = ": ping\n\n";

/** `data` is single-line JSON, so one `data:` field always suffices. */
export function envelopeFrame(entry: Entry): string {
  return `id: ${entry.id}\nevent: envelope\ndata: ${JSON.stringify(entry.event)}\n\n`;
}

export function gapFrame(cursor: string): string {
  return `event: gap\ndata: ${JSON.stringify({ cursor })}\n\n`;
}
