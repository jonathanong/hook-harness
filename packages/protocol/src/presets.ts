import type { EventFilter } from "./types.ts";

/** Merge-queue removal reasons that mean the PR was ejected (not merged or removed by hand). */
export const EJECTION_REASONS = [
  "CI_FAILURE",
  "CI_TIMEOUT",
  "MERGE_CONFLICT",
  "BRANCH_PROTECTIONS",
  "GIT_TREE_INVALID",
  "INVALID_MERGE_COMMIT",
  "QUEUE_CLEARED",
  "ROLLBACK",
  "UNKNOWN_REMOVAL_REASON",
];

/** Named filters for common triggers. */
export const PRESETS: Record<string, EventFilter> = {
  ejection: { event: "pull_request", action: "dequeued", reason: EJECTION_REASONS },
  // check_suite too: an App subscribed to Checks but not Workflow runs only gets check_suite.
  "main-failure": {
    event: ["workflow_run", "check_suite"],
    action: "completed",
    conclusion: "failure",
    branch: "main",
  },
  "review-requested": { event: "pull_request", action: "review_requested" },
  "dependabot-pr": {
    event: "pull_request",
    action: ["opened", "reopened"],
    sender: "dependabot[bot]",
  },
};

/**
 * A preset name, or a parameterised one: `/shepherd` (a new comment with that command),
 * `label:<name>` (that label added to an issue or PR), `review-requested:<login or team>`.
 */
export function preset(name: string): EventFilter | undefined {
  if (/^\/[\w-]+$/.test(name)) {
    return { event: "issue_comment", action: "created", command: name.toLowerCase() };
  }
  const [kind, arg] = name.split(/:(.*)/s, 2);
  if (kind === "label" && arg) return { action: "labeled", label: arg };
  if (kind === "review-requested" && arg) return { ...PRESETS["review-requested"], reviewer: arg };
  return Object.hasOwn(PRESETS, name) ? PRESETS[name] : undefined;
}
