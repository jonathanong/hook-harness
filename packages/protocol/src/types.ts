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
  /** Account that owns the repo, or the org/installation account for owner-level events. */
  owner: string;
  /** `owner/name`; null for owner-level events (e.g. `installation`, `organization`). */
  repo: string | null;
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
  /** Lowercased first token of a comment or review body when it is a slash command, e.g. `/plan`. */
  command: string | null;
  commentId: number | null;
  /** Who triggered the delivery. */
  sender: { login: string; type: string } | null;
  /** Author of the comment or review; differs from `sender` when someone else edits or deletes it. */
  author?: { login: string; type: string } | null;
  /** The author's relationship to the repo: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, ... */
  authorAssociation: string | null;
  url: string | null;
  /** Label added or removed (`labeled`/`unlabeled` on issues and PRs). */
  label?: string | null;
  /** Requested reviewer login or team slug (`review_requested`/`review_request_removed`). */
  requestedReviewer?: string | null;
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
  /** Label added or removed, e.g. `needs-review`; pair with action `labeled`. */
  label?: string | string[];
  /** Requested reviewer login or team slug; pair with action `review_requested`. */
  reviewer?: string | string[];
  /** Sender login(s), e.g. `dependabot[bot]`. */
  sender?: string | string[];
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
