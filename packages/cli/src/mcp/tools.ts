import type { EventFilter } from "@hook-harness/protocol";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { resolveClient } from "../client.ts";
import type { Ctx } from "../types.ts";
import { collect } from "../watch/collect.ts";
import { advance, encodeCursor } from "../watch/cursor.ts";
import { matchesAny, startFrom, type Session } from "../watch/session.ts";
import { relaySource } from "../watch/source.ts";
import { readCursor, writeCursor } from "../watch/store.ts";
import type { ScopeInput, WaitInput } from "./schema.ts";

export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const INTERVAL_MS = 15_000;

export function ok(result: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: `error: ${message}` }], isError: true };
}

/** Maps any thrown error (auth, usage, relay down, bad cursor) to an MCP tool error. */
export async function guarded(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Stateless unless `cursor_name` is given; `after` wins over the state file, then `since`, then now. */
async function openToolSession(
  input: ScopeInput,
  ctx: Ctx,
  timing: { timeoutMs: number; settleMs: number },
): Promise<Session> {
  const client = await resolveClient(ctx.env);
  const name = input.cursor_name;
  const stored = !input.after && name ? await readCursor(ctx.env, name) : undefined;
  return {
    source: relaySource(
      ctx,
      client,
      { owner: input.owner, repos: input.repos ?? [], payload: input.include_payload },
      INTERVAL_MS,
    ),
    filters: (input.filters ?? []) as EventFilter[],
    cursor: startFrom(input.after || stored, input.since, ctx),
    intervalMs: INTERVAL_MS,
    ...timing,
    save: async (next) => {
      if (name) await writeCursor(ctx.env, name, encodeCursor(next));
    },
  };
}

/** Same ctx, but also aborted when this MCP request is cancelled. */
function cancellable(ctx: Ctx, extra: Extra): Ctx {
  return { ...ctx, signal: AbortSignal.any([ctx.signal, extra.signal]) };
}

const CANCELLED = "cancelled before any events were delivered";

/** Progress notifications, only when the client sent a progressToken. */
function progressReporter(
  extra: Extra,
  totalMs: number,
): ((elapsedMs: number) => void) | undefined {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return undefined;
  let last = -1;
  return (elapsedMs) => {
    last = Math.max(elapsedMs, last + 1);
    extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress: last, total: totalMs, message: "waiting for events" },
      })
      .catch(() => undefined);
  };
}

export function waitForEvents(input: WaitInput, ctx: Ctx, extra: Extra): Promise<CallToolResult> {
  return guarded(async () => {
    const timeoutMs = input.timeout_seconds * 1000;
    const session = await openToolSession(input, cancellable(ctx, extra), {
      timeoutMs,
      settleMs: input.settle_seconds * 1000,
    });
    const result = await collect(
      session,
      cancellable(ctx, extra),
      progressReporter(extra, timeoutMs),
    );
    if (!result) return fail(CANCELLED);
    await session.save(result.cursor);
    return ok({ ...result, cursor: encodeCursor(result.cursor) });
  });
}

export function getEvents(input: ScopeInput, ctx: Ctx, extra: Extra): Promise<CallToolResult> {
  return guarded(async () => {
    const scoped = cancellable(ctx, extra);
    const session = await openToolSession(input, scoped, { timeoutMs: 0, settleMs: 0 });
    const poll = session.source.poll(session.cursor.sk, Number);
    const first = await poll.next();
    await poll.return(undefined); // one poll only: never reaches the retry sleep
    if (first.done) return fail(CANCELLED);
    if ("error" in first.value) throw first.value.error;
    const { page } = first.value;
    const step = advance(session.cursor, page);
    await session.save(step.next);
    return ok({
      events: step.fresh.filter((event) => matchesAny(session.filters, event)),
      gap: page.gap,
      cursor: encodeCursor(step.next),
    });
  });
}
