import type { ClientOptions, Clients } from "./aws/clients.ts";

/** Everything a command touches outside its arguments, injectable for tests. */
export interface Ctx {
  out(line: string): void;
  err(line: string): void;
  env: NodeJS.ProcessEnv;
  clients(options: ClientOptions): Clients;
  fetch: typeof fetch;
  randomBytes(size: number): Buffer;
  now(): Date;
  /** Upper bound for each CloudFormation / Lambda waiter. */
  maxWaitSeconds: number;
  paths: { template: string; bundle: string };
}

/** Returns the process exit code. */
export type Command = (args: string[], ctx: Ctx) => Promise<number>;
