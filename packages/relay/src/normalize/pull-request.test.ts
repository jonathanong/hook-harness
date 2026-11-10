import { emptyEnvelope } from "@hook-harness/protocol";
import { describe, expect, it } from "vitest";

import { ctx, fixture } from "../test-helpers/fixture.ts";
import type { Payload } from "../types.ts";
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

  it("stores every action", () => {
    expect(
      pullRequest(
        fixture("pull_request.dequeued", (p) => (p.action = "labeled")),
        ctx,
      ).action,
    ).toBe("labeled");
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
        author: { login: "bob", type: "User" },
        command: null,
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
      author: { login: "carol", type: "User" },
      command: null,
      prs: [42],
    });
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });

  it("parses commands in review and review comment bodies", () => {
    const body = (text: string | null) => (p: Payload) => {
      (p.comment ?? p.review).body = text;
    };
    expect(
      pullRequestReview(fixture("pull_request_review.submitted", body("/Shepherd now")), ctx)
        ?.command,
    ).toBe("/shepherd");
    expect(
      pullRequestReviewComment(fixture("pull_request_review_comment.created", body("/fix")), ctx)
        ?.command,
    ).toBe("/fix");
    expect(
      pullRequestReview(fixture("pull_request_review.submitted", body(null)), ctx)?.command,
    ).toBeNull();
  });

  it("has a null author without a user", () => {
    const envelope = pullRequestReview(
      fixture("pull_request_review.submitted", (p) => delete p.review.user),
      ctx,
    );
    expect(envelope?.author).toBeNull();
  });

  it("normalizes a review thread from its first comment", () => {
    expect(
      pullRequestReviewThread(fixture("pull_request_review_thread.resolved"), ctx),
    ).toMatchObject({
      event: "pull_request_review_thread",
      action: "resolved",
      authorAssociation: "MEMBER",
      url: "https://github.com/o/r/pull/42#discussion_r2",
      command: null,
      author: null,
    });
  });

  it("stores every action", () => {
    expect(
      pullRequestReview(
        fixture("pull_request_review.submitted", (p) => (p.action = "edited")),
        ctx,
      ).action,
    ).toBe("edited");
  });
});
