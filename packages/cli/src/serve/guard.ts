import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { str, UsageError, type Values } from "../args.ts";

export interface Access {
  host: string;
  port: number;
  token: string | undefined;
}

export function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** Validates `--host/--port/--allow-remote/--auth-token`; throws `UsageError` when unsafe. */
export function resolveAccess(values: Values, env: NodeJS.ProcessEnv): Access {
  const host = str(values, "host") ?? "127.0.0.1";
  const portText = str(values, "port") ?? "7391";
  const port = /^\d+$/.test(portText) ? Number(portText) : -1;
  if (port < 0 || port > 65535) throw new UsageError(`invalid --port "${portText}"`);
  const token = str(values, "auth-token") || env.HOOK_HARNESS_SERVE_TOKEN || undefined;
  if (!isLoopback(host)) {
    if (values["allow-remote"] !== true) {
      throw new UsageError(
        `refusing to bind non-loopback --host ${host}; pass --allow-remote and --auth-token`,
      );
    }
    if (!token) throw new UsageError("--allow-remote requires --auth-token");
  }
  return { host, port, token };
}

const digest = (text: string): Buffer => createHash("sha256").update(text).digest();

/**
 * With a token: `Authorization: Bearer <token>`. Without one (loopback only) the request must
 * not be a browser cross-origin call and must name a loopback Host, which blocks DNS rebinding.
 */
export function authorized(req: IncomingMessage, token: string | undefined): boolean {
  if (token) {
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    return timingSafeEqual(digest(given), digest(token));
  }
  if (req.headers.origin !== undefined) return false;
  // The pattern always matches: a bracketed IPv6 literal, or everything before the port.
  const [hostname] = /^(\[[^\]]+\]|[^:]*)/.exec(req.headers.host ?? "") as RegExpExecArray;
  return isLoopback(hostname.replace(/^\[|\]$/g, ""));
}
