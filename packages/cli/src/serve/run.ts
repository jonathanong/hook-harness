import type { AddressInfo } from "node:net";

import type { Ctx } from "../types.ts";
import type { Session } from "../watch/session.ts";
import { RingBuffer } from "./buffer.ts";
import type { Access } from "./guard.ts";
import { Hub } from "./hub.ts";
import { createServeServer } from "./server.ts";
import { newUpstream, pollUpstream } from "./upstream.ts";

export interface Limits {
  heartbeatMs: number;
  maxClientBytes: number;
  maxEvents: number;
  maxAgeMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  heartbeatMs: 15_000,
  maxClientBytes: 32 * 1024 * 1024,
  maxEvents: 1000,
  maxAgeMs: 3_600_000,
};

async function heartbeat(ctx: Ctx, hub: Hub, ms: number, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await ctx.sleep(ms, signal);
    if (!signal.aborted) hub.ping();
  }
}

/**
 * Runs the daemon until `ctx.signal` aborts or the relay rejects the token. Either way it
 * closes every stream, stops listening, and saves the upstream cursor before returning.
 */
export async function runServe(
  session: Session,
  ctx: Ctx,
  access: Access,
  limits: Limits = DEFAULT_LIMITS,
): Promise<number> {
  const upstream = newUpstream(session.cursor);
  const floorMs = Number.parseInt(session.cursor.sk, 10);
  const buffer = new RingBuffer({
    maxEvents: limits.maxEvents,
    maxAgeMs: limits.maxAgeMs,
    floorMs: Number.isNaN(floorMs) ? 0 : floorMs,
  });
  const hub = new Hub(limits.maxClientBytes);
  const server = createServeServer({ buffer, hub, upstream, token: access.token });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(access.port, access.host, resolve);
  });
  const { port } = server.address() as AddressInfo;
  const shown = access.host.includes(":") ? `[${access.host}]` : access.host;
  ctx.out(`hook-harness serve listening on http://${shown}:${port}`);

  const stop = new AbortController();
  const signal = AbortSignal.any([ctx.signal, stop.signal]);
  const beats = heartbeat(ctx, hub, limits.heartbeatMs, signal);
  try {
    await pollUpstream(session, ctx, upstream, buffer, hub);
    return 0;
  } finally {
    stop.abort();
    hub.closeAll();
    server.close();
    server.closeAllConnections();
    await beats;
    await session.save(upstream.cursor);
  }
}
