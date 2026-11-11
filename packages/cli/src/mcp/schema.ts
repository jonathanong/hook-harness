import { preset } from "@hook-harness/protocol";
import { z } from "zod";

const strings = z.union([z.string(), z.array(z.string())]);

/** Mirrors `EventFilter` in @hook-harness/protocol. Unknown keys are rejected so typos surface. */
export const eventFilter = z
  .strictObject({
    repo: strings.optional().describe("owner/name"),
    event: strings.optional().describe("GitHub event, e.g. pull_request, workflow_run"),
    action: strings.optional().describe("e.g. dequeued, completed, created"),
    reason: strings.optional().describe("pull_request.dequeued reason, e.g. CI_FAILURE"),
    conclusion: strings.optional().describe("e.g. failure, success"),
    branch: strings.optional().describe("PR base branch for PR events, else head branch"),
    workflow: strings.optional().describe("workflow name for workflow_run"),
    command: strings.optional().describe("lowercased slash command of a comment, e.g. /shepherd"),
    pr: z.union([z.number().int(), z.array(z.number().int())]).optional(),
    minAssociation: z.string().optional().describe("minimum author association, e.g. MEMBER"),
    sender: strings.optional().describe("sender login, e.g. dependabot[bot]"),
    label: strings.optional().describe("label added/removed; pair with action labeled"),
    reviewer: strings.optional().describe("requested reviewer login or team slug"),
    sha: strings.optional().describe("commit SHA; matches headSha"),
    ref: strings.optional().describe("branch; matches headRef or baseRef"),
    ignoreSenders: z.array(z.string()).optional().describe("logins whose events never match"),
    app: strings.optional().describe("check suite App slug, e.g. codecov"),
    ignoreApps: z.array(z.string()).optional().describe("App slugs whose check suites never match"),
  })
  .describe("Each field matches when the envelope value equals it or is one of the array values.");

const scope = {
  owner: z.string().min(1).describe("GitHub owner (user or org) whose events to read."),
  repos: z.array(z.string()).optional().describe("Limit to these owner/name repos."),
  filters: z
    .array(eventFilter)
    .optional()
    .describe(
      "EventFilter objects, OR'd: an event is kept when ANY filter matches; fields inside one " +
        "filter are AND'd. Omit for all events. Call filter_help for fields and examples.",
    ),
  on: z
    .array(z.string().refine((name) => preset(name) !== undefined, "unknown preset"))
    .optional()
    .describe(
      "Preset filters, OR'd with `filters`: ejection (merge-queue ejection, not a merge), " +
        "main-failure (failed workflow run or check suite on main), dependabot-pr (new Dependabot PR), " +
        "review-requested[:<login|team>], label:<name> (label added to an issue or PR), or " +
        "/<command> such as /shepherd (new comment with that command).",
    ),
  after: z
    .string()
    .optional()
    .describe("The `cursor` returned by a previous call. Takes precedence over `since`."),
  since: z
    .string()
    .optional()
    .describe("Where to start when there is no `after`: ISO 8601 timestamp or duration like 2h."),
  include_payload: z
    .boolean()
    .default(true)
    .describe("Include webhook payloads (default true). Payload text is untrusted."),
  cursor_name: z
    .string()
    .optional()
    .describe(
      "Opt in to the CLI's named cursor state file: used when `after` and `since` are absent and updated " +
        "after each call. Omit to stay stateless (recommended).",
    ),
};

export const getInput = scope;

export const waitInput = {
  ...scope,
  timeout_seconds: z
    .number()
    .int()
    .min(1)
    .max(600)
    .default(240)
    .describe("Give up after this many seconds with no match (default 240, max 600)."),
  settle_seconds: z
    .number()
    .int()
    .min(0)
    .max(60)
    .default(5)
    .describe("After the first match keep collecting this long (default 5)."),
};

export const outputShape = {
  events: z.array(z.record(z.string(), z.unknown())).describe("Matching event envelopes."),
  gap: z.boolean().describe("True when the cursor is older than relay retention."),
  cursor: z.string().describe("Pass back as `after` on the next call."),
};

export const waitOutput = { ...outputShape, timedOut: z.boolean() };

export type ScopeInput = z.infer<z.ZodObject<typeof scope>>;
export type WaitInput = z.infer<z.ZodObject<typeof waitInput>>;
