import { COMMON_HELP, parse, str, UsageError, type Values } from "../args.ts";
import { markRevoked, putToken, scanTokens, sha256Hex, type TokenItem } from "../aws/tokens.ts";
import type { Command, Ctx } from "../types.ts";
import { connect, requireOutputs } from "./common.ts";

const HELP = `hook-harness token <create|list|revoke> [flags]

  token create --repos a/b,c/d [--expires 90d] [--label x]
      Prints a new token once. --repos takes owner/name entries or *.
      --expires takes <n>d, <n>h or <n>m (default 90d).
  token list
      Shows hash prefix, label, repos, expiry and revoked state.
  token revoke <id-prefix>
      Revokes the token whose hash starts with the prefix (4+ characters).

${COMMON_HELP}`;

const UNITS: Record<string, number> = { d: 86400, h: 3600, m: 60 };

export function parseExpiry(value: string): number {
  const match = /^(\d+)([dhm])$/.exec(value);
  if (!match || Number(match[1]) === 0) {
    throw new UsageError(`invalid --expires "${value}"; use e.g. 90d, 12h or 30m`);
  }
  return Number(match[1]) * UNITS[match[2]!]!;
}

export function parseRepos(value: string | undefined): string[] {
  const repos = (value ?? "")
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
  if (repos.length === 0) throw new UsageError("--repos is required (owner/name,... or *)");
  const bad = repos.find((repo) => repo !== "*" && !/^[\w.-]+\/[\w.-]+$/.test(repo));
  if (bad) throw new UsageError(`invalid repo "${bad}"; expected owner/name or *`);
  return repos.includes("*") ? ["*"] : repos;
}

async function create(values: Values, ctx: Ctx): Promise<number> {
  const repos = parseRepos(str(values, "repos"));
  const ttl = parseExpiry(str(values, "expires") ?? "90d");
  const conn = connect(values, ctx);
  const outputs = await requireOutputs(conn);
  const token = `hh_${ctx.randomBytes(32).toString("base64url")}`;
  const now = ctx.now();
  const hash = sha256Hex(token);
  await putToken(conn.clients.ddb, outputs.TableName!, {
    PK: `token#${hash}`,
    SK: "token",
    repos,
    expiresAt: Math.floor(now.getTime() / 1000) + ttl,
    revoked: false,
    createdAt: now.toISOString(),
    label: str(values, "label") ?? "",
  });
  ctx.out(`Token id: ${hash.slice(0, 8)}`);
  ctx.out(`Token (shown once): ${token}`);
  return 0;
}

const idOf = (pk: string): string => pk.slice("token#".length, "token#".length + 8);

const row = (item: TokenItem): string =>
  [
    idOf(item.PK),
    item.label || "-",
    item.repos.join(","),
    new Date(item.expiresAt * 1000).toISOString(),
    item.revoked ? "revoked" : "active",
  ].join("  ");

async function list(values: Values, ctx: Ctx): Promise<number> {
  const conn = connect(values, ctx);
  const outputs = await requireOutputs(conn);
  const items = await scanTokens(conn.clients.ddb, outputs.TableName!);
  if (items.length === 0) {
    ctx.out("No tokens");
    return 0;
  }
  ctx.out("ID        LABEL  REPOS  EXPIRES  STATE");
  for (const item of items.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    ctx.out(row(item));
  }
  return 0;
}

async function revoke(values: Values, prefix: string | undefined, ctx: Ctx): Promise<number> {
  if (!prefix || prefix.length < 4)
    throw new UsageError("token revoke needs an id prefix (4+ characters)");
  const conn = connect(values, ctx);
  const outputs = await requireOutputs(conn);
  const matches = (await scanTokens(conn.clients.ddb, outputs.TableName!)).filter((item) =>
    item.PK.startsWith(`token#${prefix}`),
  );
  if (matches.length === 0) throw new Error(`no token matches "${prefix}"`);
  if (matches.length > 1)
    throw new Error(`"${prefix}" matches ${matches.length} tokens; use a longer prefix`);
  await markRevoked(conn.clients.ddb, outputs.TableName!, matches[0]!.PK);
  ctx.out(`Revoked token ${idOf(matches[0]!.PK)}`);
  return 0;
}

export const token: Command = async (args, ctx) => {
  const { values, positionals } = parse(args, {
    repos: { type: "string" },
    expires: { type: "string" },
    label: { type: "string" },
  });
  const [sub, arg] = positionals;
  if (values.help) {
    ctx.out(HELP);
    return 0;
  }
  if (sub === "create") return create(values, ctx);
  if (sub === "list") return list(values, ctx);
  if (sub === "revoke") return revoke(values, arg, ctx);
  throw new UsageError("usage: hook-harness token <create|list|revoke> (see --help)");
};
