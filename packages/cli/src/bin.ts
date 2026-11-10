#!/usr/bin/env node
import { defaultCtx } from "./ctx.ts";
import { main } from "./main.ts";

// Seam for the runner package: pass `{ run, service }` handlers as the third argument.
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.exitCode = await main(process.argv.slice(2), defaultCtx(process.env, controller), {});
