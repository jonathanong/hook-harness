import { mkdir, writeFile } from "node:fs/promises";

import { clientPath, type ClientConfig } from "./client/config.ts";
import { configDir } from "./state.ts";

export async function writeClient(env: NodeJS.ProcessEnv, config: ClientConfig): Promise<string> {
  await mkdir(configDir(env), { recursive: true, mode: 0o700 });
  await writeFile(clientPath(env), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return clientPath(env);
}
