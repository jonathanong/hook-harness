import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createClients } from "./aws/clients.ts";
import type { Ctx } from "./types.ts";

const relay = (path: string): string =>
  fileURLToPath(new URL(`../../relay/${path}`, import.meta.url));

export function defaultCtx(env: NodeJS.ProcessEnv = process.env): Ctx {
  return {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    env,
    clients: (options) => createClients(options, env),
    fetch: (...args) => fetch(...args),
    randomBytes,
    now: () => new Date(),
    maxWaitSeconds: Number(env.HOOK_HARNESS_MAX_WAIT) || 900,
    paths: { template: relay("template.yaml"), bundle: relay("dist/index.mjs") },
  };
}
