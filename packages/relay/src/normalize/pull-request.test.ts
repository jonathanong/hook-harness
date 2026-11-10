import { emptyEnvelope } from "@hook-harness/protocol";
import { describe, expect, it } from "vitest";

import { ctx, fixture } from "../test-helpers/fixture.ts";
import {
  pullRequest,
  pullRequestReview,
  pullRequestReviewComment,
  pullRequestReviewThread,
} from "./pull-request.ts";

const base = {
  id: "d1",
  receivedAt: ctx.receivedAt,
  repo: "o/r",
  prs: [42],
  headSha: "abc123",
  headRef: "feature",
  baseRef: "main",
};

describe("pullRequest", () => {
  it("normalizes a dequeued PR with its reason", () => {
    expect(pullRequest(fixture("pull_request.dequeued"), ctx)).toEqual(
      emptyEnvelope({
        ...base,
        event: "pull_request",
        action: "dequeued",
        reason: "CI_FAILURE",
        sender: { login: "alice", type: "User" },
        authorAssociation: "MEMBER",
        url: "https://github.com/o/r/pull/42",
      }),
    );
  });

  it("has no reason for other actions and never stores text", () => {
    const envelope = pullRequest(
      fixture("pull_request.dequeued", (p) => {
        p.action = "opened";
        delete p.reason;
      }),
      ctx,
    );
    expect(envelope?.reason).toBeNull();
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });

  it("drops actions outside the allowlist", () => {
    expect(
      pullRequest(
        fixture("pull_request.dequeued", (p) => (p.action = "labeled")),
        ctx,
      ),
    ).toBeNull();
  });
});

describe("review events", () => {
  it("normalizes a review", () => {
    expect(pullRequestReview(fixture("pull_request_review.submitted"), ctx)).toEqual(
      emptyEnvelope({
        ...base,
        event: "pull_request_review",
        action: "submitted",
        sender: { login: "bob", type: "User" },
        authorAssociation: "COLLABORATOR",
        url: "https://github.com/o/r/pull/42#pullrequestreview-1",
      }),
    );
  });

  it("normalizes a review comment", () => {
    const envelope = pullRequestReviewComment(fixture("pull_request_review_comment.created"), ctx);
    expect(envelope).toMatchObject({
      event: "pull_request_review_comment",
      action: "created",
      authorAssociation: "OWNER",
      prs: [42],
    });
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });

  it("normalizes a review thread from its first comment", () => {
    expect(
      pullRequestReviewThread(fixture("pull_request_review_thread.resolved"), ctx),
    ).toMatchObject({
      event: "pull_request_review_thread",
      action: "resolved",
      authorAssociation: "MEMBER",
      url: "https://github.com/o/r/pull/42#discussion_r2",
    });
  });

  it("drops other actions", () => {
    expect(
      pullRequestReview(
        fixture("pull_request_review.submitted", (p) => (p.action = "edited")),
        ctx,
      ),
    ).toBeNull();
  });
});
