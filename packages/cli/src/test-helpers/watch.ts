import { emptyEnvelope, type Envelope, type EventsPage } from "@hook-harness/protocol";
import { join } from "node:path";

import { harness, type Harness } from "./ctx.ts";

export type Step = EventsPage | Response | Error | ((call: number) => Step);

export interface Calls {
  urls: URL[];
  headers: Array<Record<string, string>>;
  /** Virtual clock at each call. */
  times: number[];
}

/** A logged-in harness whose relay answers from `steps`; the last step repeats. */
export async function watchHarness(steps: Step[]): Promise<Harness & { calls: Calls }> {
  const calls: Calls = { urls: [], headers: [], times: [] };
  const h = await harness();
  Object.assign(h.ctx.env, {
    HOOK_HARNESS_URL: "https://relay.example",
    HOOK_HARNESS_TOKEN: "hh_token",
    HOOK_HARNESS_STATE_DIR: join(h.dir, "state"),
  });
  h.ctx.fetch = async (input, init) => {
    calls.urls.push(new URL(String(input)));
    calls.headers.push((init?.headers ?? {}) as Record<string, string>);
    calls.times.push(h.clock.ms);
    let step: Step = steps[Math.min(calls.urls.length - 1, steps.length - 1)]!;
    if (typeof step === "function") step = step(calls.urls.length);
    if (step instanceof Error) throw step;
    if (step instanceof Response) return step;
    return Response.json(step);
  };
  return Object.assign(h, { calls });
}

export const ev = (id: string, seconds: number, over: Partial<Envelope> = {}): Envelope =>
  emptyEnvelope({
    id,
    receivedAt: new Date(Date.parse("2026-11-09T00:00:00Z") + seconds * 1000).toISOString(),
    event: "pull_request",
    repo: "o/r",
    ...over,
  });

export const page = (events: Envelope[], cursor = "sk1", gap = false): EventsPage => ({
  events,
  cursor,
  gap,
});

export const lastLine = (h: Harness): Record<string, unknown> =>
  JSON.parse(h.out.at(-1)!) as Record<string, unknown>;
