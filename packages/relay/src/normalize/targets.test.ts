import { describe, expect, it } from "vitest";

import { ctx, fixture } from "../test-helpers/fixture.ts";
import { issues } from "./comment.ts";
import { pullRequest } from "./pull-request.ts";

describe("label and reviewer signals", () => {
  it("records the label of a labeled PR or issue", () => {
    const pr = fixture("pull_request.dequeued", (p) => {
      p.action = "labeled";
      p.label = { name: "needs-review", color: "fff" };
    });
    expect(pullRequest(pr, ctx)).toMatchObject({ action: "labeled", label: "needs-review" });
    const issue = fixture("issues.opened", (p) => {
      p.action = "unlabeled";
      p.label = { name: "bug" };
    });
    expect(issues(issue, ctx)).toMatchObject({ action: "unlabeled", label: "bug" });
  });

  it("records a requested reviewer login or team slug", () => {
    const user = fixture("pull_request.dequeued", (p) => {
      p.action = "review_requested";
      p.requested_reviewer = { login: "octocat", type: "User" };
    });
    expect(pullRequest(user, ctx)).toMatchObject({ requestedReviewer: "octocat" });
    const team = fixture("pull_request.dequeued", (p) => {
      p.action = "review_requested";
      p.requested_team = { slug: "core", name: "Core" };
    });
    expect(pullRequest(team, ctx)).toMatchObject({ requestedReviewer: "core" });
  });

  it("omits both fields when the payload has neither", () => {
    const envelope = pullRequest(fixture("pull_request.dequeued"), ctx);
    expect(envelope).not.toHaveProperty("label");
    expect(envelope).not.toHaveProperty("requestedReviewer");
  });
});
