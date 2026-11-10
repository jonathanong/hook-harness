/**
 * Normalized GitHub event stored by the relay and returned to runners. The envelope holds
 * signals for filtering; `payload` carries the webhook body minus dropped top-level keys.
 */
export interface Envelope {
  v: 1;
  /** `X-GitHub-Delivery`. */
  id: string;
  /** ISO 8601 time the relay received the delivery. */
  receivedAt: string;
  event: string;
  action: string | null;
  /** `owner/name`. */
  repo: string;
  prs: number[];
  issue: number | null;
  headSha: string | null;
  headRef: string | null;
  baseRef: string | null;
  /** `pull_request.dequeued` removal reason, e.g. `CI_FAILURE`. */
  reason: string | null;
  conclusion: string | null;
  /** Workflow name for `workflow_run`. Attacker-influenced on forks. */
  workflow: string | null;
  workflowId: number | null;
  runId: number | null;
  /** Allowlisted slash command from a comment, e.g. `/plan`. Never the comment text. */
  command: string | null;
  commentId: number | null;
  sender: { login: string; type: string } | null;
  authorAssociation: string | null;
  url: string | null;
  /** Webhook payload with dropped keys removed. Untrusted text: titles, bodies, comments. */
  payload?: Record<string, unknown>;
  /** Why `payload` is absent: disabled by config, too large to store, or not requested. */
  payloadOmitted?: "disabled" | "too_large" | "not_requested";
}

/** Each field matches when the envelope value equals the string or is one of the array's values. */
export interface EventFilter {
  repo?: string | string[];
  event?: string | string[];
  action?: string | string[];
  reason?: string | string[];
  conclusion?: string | string[];
  /** Matches `baseRef` for PR events and `headRef` otherwise. */
  branch?: string | string[];
  workflow?: string | string[];
  command?: string | string[];
  pr?: number | number[];
  /** Minimum `authorAssociation`, e.g. `MEMBER`. Missing association never matches. */
  minAssociation?: string;
  /** Logins whose events never match. */
  ignoreSenders?: string[];
}

export interface EventsPage {
  events: Envelope[];
  /** Pass back as `after` on the next poll. */
  cursor: string;
  /** True when the requested cursor is older than the retention window. */
  gap: boolean;
}
