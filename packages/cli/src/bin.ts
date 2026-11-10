#!/usr/bin/env node
import { defaultCtx } from "./ctx.ts";
import { main } from "./main.ts";

// Seam for the runner package: pass `{ run, service }` handlers as the third argument.
process.exitCode = await main(process.argv.slice(2), defaultCtx(), {});
