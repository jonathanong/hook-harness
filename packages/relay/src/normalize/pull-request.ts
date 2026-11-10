import type { Context, Normalizer, Payload } from "../types.ts";
import { authorOf, build, commandOf } from "./common.ts";

function prFields(payload: Payload) {
  const pr = payload.pull_request;
  return {
    prs: [pr.number],
    headSha: pr.head.sha,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
  };
}

export const pullRequest: Normalizer = (payload, ctx) =>
  build("pull_request", payload, ctx, {
    ...prFields(payload),
    reason: payload.reason ?? null,
    authorAssociation: payload.pull_request.author_association,
    url: payload.pull_request.html_url,
  });

/** Review, review comment and review thread events: PR signals plus the object's association. */
function prObject(
  event: string,
  pick: (payload: Payload) => {
    author_association: string;
    html_url: string;
    body?: string | null;
    user?: { login: string; type: string } | null;
  },
  withText = true,
): Normalizer {
  return (payload: Payload, ctx: Context) => {
    const object = pick(payload);
    return build(event, payload, ctx, {
      ...prFields(payload),
      ...(withText && { command: commandOf(object.body), author: authorOf(object.user) }),
      authorAssociation: object.author_association,
      url: object.html_url,
    });
  };
}

export const pullRequestReview = prObject("pull_request_review", (payload) => payload.review);
export const pullRequestReviewComment = prObject(
  "pull_request_review_comment",
  (payload) => payload.comment,
);
export const pullRequestReviewThread = prObject(
  "pull_request_review_thread",
  (payload) => payload.thread.comments[0],
  false,
);
