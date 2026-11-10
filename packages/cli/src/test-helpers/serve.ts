import { serve } from "../commands/serve.ts";
import { createSseParser, type SseItem } from "../watch/sse-parser.ts";
import { watchHarness, type Step } from "./watch.ts";

interface Sleeper {
  ms: number;
  resolve(): void;
}

/** A `ctx.sleep` that only wakes on `tick` (or abort), so daemon loops advance deterministically. */
export function gatedSleep() {
  const sleepers = new Set<Sleeper>();
  return {
    sleep(ms: number, signal: AbortSignal): Promise<void> {
      // Like timers/promises: an already-aborted signal must not leave the sleeper parked.
      if (signal.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        const sleeper = { ms, resolve: () => resolve() };
        sleepers.add(sleeper);
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    /** Wakes every sleeper asking for `ms`. */
    tick(ms: number): void {
      for (const sleeper of sleepers) {
        if (sleeper.ms !== ms) continue;
        sleepers.delete(sleeper);
        sleeper.resolve();
      }
    },
  };
}

export async function until(check: () => boolean, label = "condition"): Promise<void> {
  for (let i = 0; i < 1000; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Upstream poll interval and heartbeat used by `startDaemon`. */
export const POLL_MS = 20_000;
export const BEAT_MS = 15_000;

export async function startDaemon(steps: Step[], extra: string[] = []) {
  const h = await watchHarness(steps);
  const gate = gatedSleep();
  h.ctx.sleep = gate.sleep;
  const done = serve(["--owner", "o", "--port", "0", "--interval", "20s", ...extra], h.ctx);
  done.catch(() => undefined);
  await until(() => h.out.some((line) => line.includes("listening")), "listening");
  const url = /http:\/\/\S+/.exec(h.out[0]!)![0];
  return {
    h,
    url,
    gate,
    done,
    /** Waits for the nth relay poll, then for the daemon to have processed its page. */
    async polled(n: number): Promise<void> {
      await until(() => h.calls.urls.length >= n, `relay poll ${n}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    /** Next poll: wake the poller and wait for it. */
    async poll(n: number): Promise<void> {
      gate.tick(POLL_MS);
      await this.polled(n);
    },
  };
}

/** An open SSE connection that accumulates text and exposes parsed items. */
export async function openStream(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { ...init, signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const items: SseItem[] = [];
  let ended = false;
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        items.push(...parser.push(decoder.decode(value, { stream: true })));
      }
    } catch {
      // Aborted by the test.
    }
    ended = true;
  })();
  return {
    response,
    items,
    messages: () => items.filter((item) => item.type === "message"),
    comments: () => items.filter((item) => item.type === "comment"),
    ids: () =>
      items.flatMap((item) => (item.type === "message" && item.event === "envelope" ? [item] : [])),
    close: () => controller.abort(),
    isEnded: () => ended,
    pump,
  };
}
