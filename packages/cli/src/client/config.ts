import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { configDir } from "../state.ts";
import { NotLoggedInError } from "./errors.ts";

export interface ClientConfig {
  url: string;
  token: string;
}

export const clientPath = (env: NodeJS.ProcessEnv): string => join(configDir(env), "client.json");

/**
 * The relay URL and token `hook-harness login` saved, with `HOOK_HARNESS_URL` and
 * `HOOK_HARNESS_TOKEN` overriding each field. Throws `NotLoggedInError` when either is missing.
 */
export async function resolveClient(env: NodeJS.ProcessEnv = process.env): Promise<ClientConfig> {
  let saved: Partial<ClientConfig> = {};
  try {
    saved = JSON.parse(await readFile(clientPath(env), "utf8")) as Partial<ClientConfig>;
  } catch {
    // No saved login; env vars may still supply everything.
  }
  const url = env.HOOK_HARNESS_URL || saved.url;
  const token = env.HOOK_HARNESS_TOKEN || saved.token;
  if (!url || !token) {
    throw new NotLoggedInError(
      "not logged in; run `hook-harness login --url <function url> --token <hh_...>` " +
        "or set HOOK_HARNESS_URL and HOOK_HARNESS_TOKEN",
    );
  }
  return { url, token };
}
