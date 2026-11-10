import { UsageError } from "./args.ts";

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** `15s`, `10m`, `2h`, `1d`, `500ms` to milliseconds. */
export function parseDuration(value: string, flag: string, allowZero = false): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value);
  const ms = match ? Number(match[1]) * UNITS[match[2]!]! : 0;
  if (!match || (ms === 0 && !allowZero)) {
    throw new UsageError(`invalid --${flag} "${value}"; use e.g. 15s, 10m, 2h`);
  }
  return ms;
}

/** An ISO 8601 timestamp or a duration meaning "that long ago". Returns epoch ms. */
export function parseSince(value: string, nowMs: number): number {
  if (/^\d+(ms|s|m|h|d)$/.test(value)) return nowMs - parseDuration(value, "since", true);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new UsageError(
      `invalid --since "${value}"; use an ISO 8601 timestamp or a duration like 2h`,
    );
  }
  return parsed;
}
