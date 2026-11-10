import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { UsageError } from "./args.ts";
import { configDir } from "./state.ts";

export interface ClientConfig {
  url: string;
  token: string;
}

export const clientPath = (env: NodeJS.ProcessEnv): string => join(configDir(env), "client.json");

export async function writeClient(env: NodeJS.ProcessEnv, config: ClientConfig): Promise<string> {
  await mkdir(configDir(env), { recursive: true, mode: 0o700 });
  await writeFile(clientPath(env), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return clientPath(env);
}

/** `HOOK_HARNESS_URL` / `HOOK_HARNESS_TOKEN` override fields from `client.json`. */
export async function resolveClient(env: NodeJS.ProcessEnv): Promise<ClientConfig> {
  let saved: Partial<ClientConfig> = {};
  try {
    saved = JSON.parse(await readFile(clientPath(env), "utf8")) as Partial<ClientConfig>;
  } catch {
    // No saved login; env vars may still supply everything.
  }
  const url = env.HOOK_HARNESS_URL || saved.url;
  const token = env.HOOK_HARNESS_TOKEN || saved.token;
  if (!url || !token) {
    throw new UsageError(
      "not logged in; run `hook-harness login --url <function url> --token <hh_...>` " +
        "or set HOOK_HARNESS_URL and HOOK_HARNESS_TOKEN",
    );
  }
  return { url, token };
}
