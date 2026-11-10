import { createHash } from "node:crypto";

export const DAY_SECONDS = 86_400;
export const DAY_MS = DAY_SECONDS * 1000;
/** Events are replayed this much before the caller's cursor to tolerate late writes. */
export const OVERLAP_MS = 60_000;

/** Epoch milliseconds zero-padded so string order equals time order. */
export function padMs(ms: number): string {
  return String(ms).padStart(15, "0");
}

/** Event partition: one per (lower-cased) repository owner. */
export function eventPk(owner: string): string {
  return `owner#${owner.toLowerCase()}`;
}

export function eventSk(receivedAtMs: number, deliveryId: string): string {
  return `${padMs(receivedAtMs)}#${deliveryId}`;
}

/** Epoch seconds at which an event received at `receivedAtMs` expires (table TTL). */
export function eventExpiresAt(receivedAtMs: number): number {
  return Math.floor(receivedAtMs / 1000) + DAY_SECONDS;
}

/** SHA-256 hex of a plaintext bearer token. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenPk(hash: string): string {
  return `token#${hash}`;
}

/** Primary key of the token item for a plaintext bearer token. */
export function tokenKey(token: string): { PK: string; SK: "token" } {
  return { PK: tokenPk(tokenHash(token)), SK: "token" };
}

/** Scope entries are `owner/name`, `owner/*` or `*`; matching is case-insensitive. */
export function tokenAllowsRepo(scopes: string[], repo: string): boolean {
  const target = repo.toLowerCase();
  const owner = target.split("/")[0];
  return scopes.some((scope) => {
    const entry = scope.toLowerCase();
    return entry === "*" || entry === target || entry === `${owner}/*`;
  });
}

/** True when the token allows at least one repository under `owner`. */
export function tokenAllowsOwner(scopes: string[], owner: string): boolean {
  const target = owner.toLowerCase();
  return scopes.some((scope) => {
    const entry = scope.toLowerCase();
    return entry === "*" || entry.split("/")[0] === target;
  });
}
