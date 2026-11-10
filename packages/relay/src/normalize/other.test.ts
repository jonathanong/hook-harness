import { describe, expect, it } from "vitest";

import { ctx, fixture } from "../test-helpers/fixture.ts";
import type { Payload } from "../types.ts";
import { mergeGroup, push } from "./branch.ts";
import { checkSuite, status, workflowRun } from "./checks.ts";
import { issueComment } from "./comment.ts";
import { normalizers } from "./index.ts";

describe("issueComment", () => {
  it("stores an allowlisted command on a PR without the text", () => {
    const envelope = issueComment(fixture("issue_comment.created"), ctx);
    expect(envelope).toMatchObject({
      event: "issue_comment",
      command: "/plan",
      commentId: 555,
      issue: 7,
      prs: [7],
      authorAssociation: "MEMBER",
      url: "https://github.com/o/r/pull/7#issuecomment-555",
    });
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });

  it("leaves prs empty for plain issues", () => {
    const envelope = issueComment(
      fixture("issue_comment.created", (p) => delete p.issue.pull_request),
      ctx,
    );
    expect(envelope?.prs).toEqual([]);
    expect(envelope?.issue).toBe(7);
  });

  it("drops other comments, empty bodies and other actions", () => {
    const body = (text: string) => (p: Payload) => (p.comment.body = text);
    expect(issueComment(fixture("issue_comment.created", body("/deploy now")), ctx)).toBeNull();
    expect(issueComment(fixture("issue_comment.created", body("")), ctx)).toBeNull();
    expect(issueComment(fixture("issue_comment.created", body("hi /plan")), ctx)).toBeNull();
    expect(
      issueComment(
        fixture("issue_comment.created", (p) => (p.action = "edited")),
        ctx,
      ),
    ).toBeNull();
  });
});

describe("checks", () => {
  it("normalizes a completed check suite", () => {
    expect(checkSuite(fixture("check_suite.completed"), ctx)).toMatchObject({
      event: "check_suite",
      prs: [42, 43],
      headSha: "abc123",
      headRef: "feature",
      conclusion: "failure",
      url: "https://github.com/o/r/commit/abc123",
      sender: { login: "github-actions[bot]", type: "Bot" },
    });
  });

  it("normalizes a completed workflow run", () => {
    const envelope = workflowRun(fixture("workflow_run.completed"), ctx);
    expect(envelope).toMatchObject({
      event: "workflow_run",
      workflow: "CI",
      workflowId: 77,
      runId: 9001,
      conclusion: "failure",
      headRef: "main",
      headSha: "abc123",
      prs: [],
      url: "https://github.com/o/r/actions/runs/9001",
    });
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });

  it("collects PR numbers from a workflow run", () => {
    const run = fixture("workflow_run.completed", (p) => {
      p.workflow_run.pull_requests = [{ number: 9 }];
    });
    expect(workflowRun(run, ctx)?.prs).toEqual([9]);
  });

  it("drops incomplete runs and suites", () => {
    const requested = (p: Payload) => (p.action = "requested");
    expect(checkSuite(fixture("check_suite.completed", requested), ctx)).toBeNull();
    expect(workflowRun(fixture("workflow_run.completed", requested), ctx)).toBeNull();
  });

  it("maps status state to conclusion", () => {
    const envelope = status(fixture("status"), ctx);
    expect(envelope).toMatchObject({
      event: "status",
      action: null,
      headSha: "abc123",
      conclusion: "failure",
      headRef: null,
      url: "https://github.com/o/r/commit/abc123",
    });
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });
});

describe("mergeGroup", () => {
  it("parses the PR from the queue ref", () => {
    expect(mergeGroup(fixture("merge_group.destroyed"), ctx)).toMatchObject({
      event: "merge_group",
      action: "destroyed",
      reason: "invalidated",
      prs: [42],
      baseRef: "main",
      headRef: "gh-readonly-queue/main/pr-42-abc123abc123",
      headSha: "def456",
    });
  });

  it("tolerates an unparseable ref and a missing reason", () => {
    const envelope = mergeGroup(
      fixture("merge_group.destroyed", (p) => {
        p.action = "checks_requested";
        delete p.reason;
        p.merge_group.head_ref = "refs/heads/odd";
      }),
      ctx,
    );
    expect(envelope).toMatchObject({ prs: [], reason: null });
  });

  it("drops other actions", () => {
    expect(
      mergeGroup(
        fixture("merge_group.destroyed", (p) => (p.action = "other")),
        ctx,
      ),
    ).toBeNull();
  });
});

describe("push", () => {
  it("keeps default-branch pushes", () => {
    expect(push(fixture("push"), ctx)).toMatchObject({
      event: "push",
      action: null,
      headRef: "main",
      headSha: "abc123",
      url: "https://github.com/o/r/compare/000...abc123",
    });
  });

  it("drops other branches", () => {
    expect(
      push(
        fixture("push", (p) => (p.ref = "refs/heads/dev")),
        ctx,
      ),
    ).toBeNull();
  });
});

describe("normalizers", () => {
  it("is a static allowlist", () => {
    expect([...normalizers.keys()].sort()).toEqual([
      "check_suite",
      "issue_comment",
      "merge_group",
      "pull_request",
      "pull_request_review",
      "pull_request_review_comment",
      "pull_request_review_thread",
      "push",
      "status",
      "workflow_run",
    ]);
    expect(normalizers.get("constructor")).toBeUndefined();
  });
});
