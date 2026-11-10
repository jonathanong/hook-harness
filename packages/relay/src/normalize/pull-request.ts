import type { Context, Normalizer, Payload } from "../types.ts";
import { build } from "./common.ts";

const PR_ACTIONS = new Set([
  "opened",
  "reopened",
  "closed",
  "synchronize",
  "ready_for_review",
  "converted_to_draft",
  "auto_merge_enabled",
  "auto_merge_disabled",
  "enqueued",
  "dequeued",
]);

function prFields(payload: Payload) {
  const pr = payload.pull_request;
  return {
    prs: [pr.number],
    headSha: pr.head.sha,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
  };
}

export const pullRequest: Normalizer = (payload, ctx) => {
  if (!PR_ACTIONS.has(payload.action)) return null;
  return build("pull_request", payload, ctx, {
    ...prFields(payload),
    reason: payload.reason ?? null,
    authorAssociation: payload.pull_request.author_association,
    url: payload.pull_request.html_url,
  });
};

/** Review, review comment and review thread events: PR signals plus the object's association. */
function prObject(
  event: string,
  actions: string[],
  pick: (payload: Payload) => { author_association: string; html_url: string },
): Normalizer {
  const allowed = new Set(actions);
  return (payload: Payload, ctx: Context) => {
    if (!allowed.has(payload.action)) return null;
    const object = pick(payload);
    return build(event, payload, ctx, {
      ...prFields(payload),
      authorAssociation: object.author_association,
      url: object.html_url,
    });
  };
}

export const pullRequestReview = prObject(
  "pull_request_review",
  ["submitted", "dismissed"],
  (payload) => payload.review,
);
export const pullRequestReviewComment = prObject(
  "pull_request_review_comment",
  ["created"],
  (payload) => payload.comment,
);
export const pullRequestReviewThread = prObject(
  "pull_request_review_thread",
  ["resolved", "unresolved"],
  (payload) => payload.thread.comments[0],
);
