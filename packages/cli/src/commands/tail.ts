import { COMMON_HELP, parse } from "../args.ts";
import type { Command } from "../types.ts";
import { advance, encodeCursor } from "../watch/cursor.ts";
import { LOGIN_HELP, WATCH_FLAGS, WATCH_SPEC } from "../watch/flags.ts";
import { matchesAny, openSession } from "../watch/session.ts";

const HELP = `hook-harness tail --owner <owner> [flags]

Streams matching events as NDJSON until interrupted (SIGINT), saving the cursor as it goes.
Each line is {"event":{...},"cursor":"..."}; a relay gap prints {"gap":true,"cursor":"..."}.
All lines from one poll share that poll's end cursor; pass a cursor back as --after to resume.
Transient errors are retried with backoff and reported on stderr; 401/403 exit 1.

${WATCH_FLAGS}

${COMMON_HELP}

${LOGIN_HELP}`;

export const tail: Command = async (args, ctx) => {
  const { values } = parse(args, WATCH_SPEC);
  if (values.help) {
    ctx.out(HELP);
    return 0;
  }
  const session = await openSession(values, ctx, "30m");
  let cursor = session.cursor;
  for await (const result of session.source.poll(cursor.sk, () => session.intervalMs)) {
    if ("error" in result) {
      ctx.err(`warning: ${result.error.message}; retrying`);
      continue;
    }
    const step = advance(cursor, result.page);
    cursor = step.next;
    const encoded = encodeCursor(cursor);
    if (result.page.gap) ctx.out(JSON.stringify({ gap: true, cursor: encoded }));
    for (const event of step.fresh) {
      if (matchesAny(session.filters, event)) ctx.out(JSON.stringify({ event, cursor: encoded }));
    }
    await session.save(cursor);
  }
  return 0;
};
