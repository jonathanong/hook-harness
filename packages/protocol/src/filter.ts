import type { Envelope, EventFilter } from "./types.ts";

/** Highest trust first. */
export const ASSOCIATIONS = [
  "OWNER",
  "MEMBER",
  "COLLABORATOR",
  "CONTRIBUTOR",
  "FIRST_TIME_CONTRIBUTOR",
  "FIRST_TIMER",
  "NONE",
] as const;

export function associationAtLeast(actual: string | null, minimum: string): boolean {
  if (actual === null) return false;
  const actualRank = ASSOCIATIONS.indexOf(actual as (typeof ASSOCIATIONS)[number]);
  const minimumRank = ASSOCIATIONS.indexOf(minimum as (typeof ASSOCIATIONS)[number]);
  if (actualRank === -1 || minimumRank === -1) return false;
  return actualRank <= minimumRank;
}

function oneOf<T>(expected: T | T[] | undefined, actual: T | null): boolean {
  if (expected === undefined) return true;
  if (actual === null) return false;
  return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

const PR_EVENTS = new Set([
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_review_thread",
]);

export function branchOf(envelope: Envelope): string | null {
  return PR_EVENTS.has(envelope.event) ? envelope.baseRef : envelope.headRef;
}

export function matches(envelope: Envelope, filter: EventFilter): boolean {
  if (
    filter.ignoreSenders &&
    envelope.sender &&
    filter.ignoreSenders.includes(envelope.sender.login)
  )
    return false;
  if (
    filter.minAssociation !== undefined &&
    !associationAtLeast(envelope.authorAssociation, filter.minAssociation)
  ) {
    return false;
  }
  if (filter.pr !== undefined) {
    const wanted = Array.isArray(filter.pr) ? filter.pr : [filter.pr];
    if (!envelope.prs.some((pr) => wanted.includes(pr))) return false;
  }
  return (
    oneOf(filter.repo, envelope.repo) &&
    oneOf(filter.event, envelope.event) &&
    oneOf(filter.action, envelope.action) &&
    oneOf(filter.reason, envelope.reason) &&
    oneOf(filter.conclusion, envelope.conclusion) &&
    oneOf(filter.branch, branchOf(envelope)) &&
    oneOf(filter.workflow, envelope.workflow) &&
    oneOf(filter.command, envelope.command) &&
    oneOf(filter.sender, envelope.sender?.login ?? null) &&
    oneOf(filter.label, envelope.label ?? null) &&
    oneOf(filter.reviewer, envelope.requestedReviewer ?? null) &&
    oneOf(filter.sha, envelope.headSha) &&
    (filter.ref === undefined ||
      oneOf(filter.ref, envelope.headRef) ||
      oneOf(filter.ref, envelope.baseRef))
  );
}
