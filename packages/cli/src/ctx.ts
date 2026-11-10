import { randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import { resolveRelayAssets } from "./assets.ts";
import { createClients } from "./aws/clients.ts";
import type { Ctx } from "./types.ts";

export function defaultCtx(
  env: NodeJS.ProcessEnv = process.env,
  controller: AbortController = new AbortController(),
): Ctx {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    env,
    clients: (options) => createClients(options, env),
    fetch: (...args) => fetch(...args),
    randomBytes,
    now: () => new Date(),
    sleep: (ms, signal) => setTimeout(ms, undefined, { signal }).catch(() => undefined),
    signal: controller.signal,
    maxWaitSeconds: Number(env.HOOK_HARNESS_MAX_WAIT) || 900,
    paths: resolveRelayAssets(import.meta.url),
  };
}
