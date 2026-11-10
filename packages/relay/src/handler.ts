import { handleEvents } from "./events.ts";
import { fail } from "./respond.ts";
import type { Deps, UrlEvent, UrlResult } from "./types.ts";
import { handleWebhook } from "./webhook.ts";

export async function route(event: UrlEvent, deps: Deps): Promise<UrlResult> {
  try {
    const key = `${event.requestContext.http.method} ${event.rawPath}`;
    if (key === "POST /webhook") return await handleWebhook(event, deps);
    if (key === "GET /events") return await handleEvents(event, deps);
    return fail(404, "not found");
  } catch (error) {
    console.error(`relay error: ${(error as Error).name}`);
    return fail(500, "internal error");
  }
}
