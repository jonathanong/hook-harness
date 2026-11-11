import type { EventFilter } from "@hook-harness/protocol";

import type { Values } from "../args.ts";
import { buildFilters, withRepos } from "../watch/flags.ts";

const REPEATED = [
  "event",
  "action",
  "reason",
  "conclusion",
  "branch",
  "workflow",
  "command",
  "sender",
  "label",
  "reviewer",
  "sha",
  "ref",
  "app",
  "on",
  "pr",
];

/**
 * Query params mirror `wait`'s flags and reuse its filter builder. `filter` is repeatable
 * EventFilter JSON; every filter (the param-built one plus each `filter`) is OR'd.
 * Throws `UsageError` for a bad `pr`, `on` or `filter`.
 */
export function filtersFromQuery(params: URLSearchParams): EventFilter[] {
  const values: Values = {};
  const renamed: Record<string, string> = {
    ignoreSender: "ignore-sender",
    ignoreApp: "ignore-app",
  };
  for (const key of [...REPEATED, "ignoreSender", "ignoreApp", "filter"]) {
    const found = params.getAll(key);
    if (found.length > 0) values[renamed[key] ?? key] = found;
  }
  const association = params.get("minAssociation");
  if (association) values["min-association"] = association;
  const repos = params
    .getAll("repo")
    .flatMap((repo) => repo.split(","))
    .filter(Boolean);
  return withRepos(buildFilters(values), repos);
}
