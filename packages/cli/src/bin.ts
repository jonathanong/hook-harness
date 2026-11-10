#!/usr/bin/env node
import { defaultCtx } from "./ctx.ts";
import { main } from "./main.ts";

// Seam for the runner package: pass `{ run, service }` handlers as the third argument.
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => controller.abort());
}
process.exitCode = await main(process.argv.slice(2), defaultCtx(process.env, controller), {});
