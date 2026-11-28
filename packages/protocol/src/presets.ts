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
  // Actions failures come from workflow_run (with runId); check_suite adds other Apps' failures
  // (codecov, ...). Actions' own check suites are skipped so each failure arrives once.
  "main-failure": {
    event: ["workflow_run", "check_suite"],
    action: "completed",
    conclusion: "failure",
    branch: "main",
    ignoreApps: ["github-actions"],
  },
  "review-requested": { event: "pull_request", action: "review_requested" },
  // A deployment finished (any environment); `deployment:<environment>` narrows it.
  deployment: { event: "deployment_status", conclusion: ["success", "failure", "error"] },
  // A release was published (any tag); `release:<tag>` narrows it.
  release: { event: "release", action: "published" },
  "dependabot-pr": {
    event: "pull_request",
    action: ["opened", "reopened"],
    sender: "dependabot[bot]",
  },
};

/**
 * A preset name, or a parameterised one: `/shepherd` (a new comment with that command),
 * `label:<name>` (that label added to an issue or PR), `review-requested:<login or team>`,
 * `workflow:<name>[@<branch>]` (a run of that Actions workflow finished, on that branch),
 * `deployment:<environment>[@<branch>]` (a deployment there succeeded or failed),
 * `release:<tag>` (that release was published), `status:<context>` (that commit status finished).
 */
export function preset(name: string): EventFilter | undefined {
  if (/^\/[\w-]+$/.test(name)) {
    return { event: "issue_comment", action: "created", command: name.toLowerCase() };
  }
  const [kind, arg] = name.split(/:(.*)/s, 2);
  if (arg && kind && Object.hasOwn(PARAMETERISED, kind)) return PARAMETERISED[kind]!(arg);
  return Object.hasOwn(PRESETS, name) ? PRESETS[name] : undefined;
}

/** `<value>[@<branch>]`, split at the last `@`; undefined for an empty branch. */
function atBranch(arg: string): { value: string; branch?: string } | undefined {
  const at = arg.lastIndexOf("@");
  if (at <= 0) return { value: arg };
  const branch = arg.slice(at + 1);
  return branch ? { value: arg.slice(0, at), branch } : undefined;
}

/** States that end a deployment or a commit status; `pending` and friends do not. */
const FINISHED = ["success", "failure", "error"];

/** Parameterised presets: `kind:<arg>`. Each returns undefined for an arg it cannot use. */
const PARAMETERISED: Record<string, (arg: string) => EventFilter | undefined> = {
  label: (arg) => ({ action: "labeled", label: arg }),
  "review-requested": (arg) => ({ ...PRESETS["review-requested"], reviewer: arg }),
  // Any conclusion: waiting for a run to finish is the point (success, failure or cancelled).
  workflow: (arg) => {
    const parsed = atBranch(arg);
    if (!parsed) return undefined;
    const { value: workflow, branch } = parsed;
    return { event: "workflow_run", action: "completed", workflow, ...(branch ? { branch } : {}) };
  },
  deployment: (arg) => {
    const parsed = atBranch(arg);
    if (!parsed) return undefined;
    const { value: environment, branch } = parsed;
    return { ...PRESETS["deployment"], environment, ...(branch ? { branch } : {}) };
  },
  release: (tag) => ({ ...PRESETS["release"], tag }),
  status: (context) => ({ event: "status", conclusion: FINISHED, context }),
};
