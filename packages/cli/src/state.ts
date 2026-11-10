import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DeploymentState {
  stack: string;
  region?: string;
  functionUrl: string;
  webhookUrl: string;
  functionName: string;
  tableName: string;
  /** Present only when the CLI generated or was given the secret. */
  webhookSecret?: string;
  updatedAt: string;
}

/** `HOOK_HARNESS_CONFIG_DIR`, else `$XDG_CONFIG_HOME/hook-harness`, else `~/.config/hook-harness`. */
export function configDir(env: NodeJS.ProcessEnv): string {
  if (env.HOOK_HARNESS_CONFIG_DIR) return env.HOOK_HARNESS_CONFIG_DIR;
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "hook-harness");
}

export function statePath(env: NodeJS.ProcessEnv, stack: string): string {
  return join(configDir(env), "deployments", `${stack}.json`);
}

export async function readState(
  env: NodeJS.ProcessEnv,
  stack: string,
): Promise<DeploymentState | undefined> {
  try {
    return JSON.parse(await readFile(statePath(env, stack), "utf8")) as DeploymentState;
  } catch {
    return undefined;
  }
}

export async function writeState(env: NodeJS.ProcessEnv, state: DeploymentState): Promise<string> {
  const path = statePath(env, state.stack);
  await mkdir(join(configDir(env), "deployments"), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export async function removeState(env: NodeJS.ProcessEnv, stack: string): Promise<void> {
  await rm(statePath(env, stack), { force: true });
}
