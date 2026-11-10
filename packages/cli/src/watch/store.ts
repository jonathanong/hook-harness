import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { UsageError } from "../args.ts";

/** `HOOK_HARNESS_STATE_DIR`, else `$XDG_STATE_HOME/hook-harness`, else `~/.local/state/hook-harness`. */
export function stateDir(env: NodeJS.ProcessEnv): string {
  if (env.HOOK_HARNESS_STATE_DIR) return env.HOOK_HARNESS_STATE_DIR;
  return join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "hook-harness");
}

function cursorPath(env: NodeJS.ProcessEnv, name: string): string {
  if (!/^[\w.-]+$/.test(name)) throw new UsageError(`invalid --cursor name "${name}"`);
  return join(stateDir(env), "cursors", `${name}.json`);
}

/** The stored encoded cursor, if any. */
export async function readCursor(
  env: NodeJS.ProcessEnv,
  name: string,
): Promise<string | undefined> {
  const path = cursorPath(env, name);
  try {
    return (JSON.parse(await readFile(path, "utf8")) as { cursor: string }).cursor;
  } catch {
    return undefined;
  }
}

export async function writeCursor(
  env: NodeJS.ProcessEnv,
  name: string,
  cursor: string,
): Promise<void> {
  const path = cursorPath(env, name);
  await mkdir(join(stateDir(env), "cursors"), { recursive: true });
  await writeFile(path, `${JSON.stringify({ cursor })}\n`);
}
