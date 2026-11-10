import { readFileSync } from "node:fs";

import type { Context, Payload } from "../types.ts";

/** Fresh copy of a fixture payload, optionally edited by `edit`. */
export function fixture(name: string, edit?: (payload: Payload) => void): Payload {
  const payload = JSON.parse(
    readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Payload;
  edit?.(payload);
  return payload;
}

export const ctx: Context = {
  id: "d1",
  receivedAt: "2026-11-09T00:00:00.000Z",
};
