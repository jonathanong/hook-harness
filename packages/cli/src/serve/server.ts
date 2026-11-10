import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { EventFilter } from "@hook-harness/protocol";

import { decodeCursor, type Cursor } from "../watch/cursor.ts";
import { matchesAny } from "../watch/session.ts";
import type { RingBuffer } from "./buffer.ts";
import { envelopeFrame, gapFrame } from "./frames.ts";
import { authorized } from "./guard.ts";
import type { Hub } from "./hub.ts";
import { filtersFromQuery } from "./query.ts";
import type { Upstream } from "./upstream.ts";

export interface ServerDeps {
  buffer: RingBuffer;
  hub: Hub;
  upstream: Upstream;
  token: string | undefined;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Replays from the ring buffer, then registers the client for live events (same tick). */
function stream(deps: ServerDeps, req: IncomingMessage, res: ServerResponse, url: URL): void {
  const { buffer, hub, upstream } = deps;
  let filters: EventFilter[];
  let after: Cursor | undefined;
  try {
    filters = filtersFromQuery(url.searchParams);
    const text = req.headers["last-event-id"] ?? url.searchParams.get("after");
    after = text ? decodeCursor(String(text)) : undefined;
  } catch (error) {
    json(res, 400, { error: (error as Error).message });
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
  const client = hub.add(res, filters);
  res.on("close", () => hub.remove(client));
  if (!after) return;
  const replay = buffer.replay(after);
  if (replay.gap) hub.send(client, gapFrame(buffer.head ?? upstream.health.cursor));
  for (const entry of replay.entries) {
    if (matchesAny(filters, entry.event)) hub.send(client, envelopeFrame(entry));
  }
}

export function createServeServer(deps: ServerDeps): Server {
  return createServer((req, res) => {
    if (!authorized(req, deps.token)) {
      json(res, deps.token ? 401 : 403, { error: "unauthorized" });
      return;
    }
    if (req.method !== "GET") {
      json(res, 405, { error: "method not allowed" });
      return;
    }
    const url = new URL(req.url as string, "http://serve.local");
    if (url.pathname === "/healthz") {
      const { health } = deps.upstream;
      json(res, 200, {
        ok: health.lastError === null,
        upstream: health,
        clients: deps.hub.size,
        buffered: deps.buffer.size,
      });
    } else if (url.pathname === "/events") {
      stream(deps, req, res, url);
    } else {
      json(res, 404, { error: "not found" });
    }
  });
}
