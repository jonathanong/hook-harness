import { describe, expect, it } from "vitest";

import { ctx, fixture } from "../test-helpers/fixture.ts";
import { commitComment, issues } from "./comment.ts";
import { normalizers } from "./index.ts";

describe("issues", () => {
  it("stores the issue lifecycle with author provenance", () => {
    expect(issues(fixture("issues.opened"), ctx)).toMatchObject({
      event: "issues",
      action: "opened",
      issue: 12,
      prs: [],
      command: null,
      author: { login: "frank", type: "User" },
      authorAssociation: "COLLABORATOR",
      url: "https://github.com/o/r/issues/12",
    });
  });

  it("handles a ghost author", () => {
    const envelope = issues(
      fixture("issues.opened", (p) => (p.issue.user = null)),
      ctx,
    );
    expect(envelope?.author).toBeNull();
  });
});

describe("commitComment", () => {
  it("stores the commit SHA, command and provenance", () => {
    expect(commitComment(fixture("commit_comment.created"), ctx)).toMatchObject({
      event: "commit_comment",
      action: "created",
      command: "/fix",
      commentId: 777,
      headSha: "abc123",
      author: { login: "gina", type: "User" },
      authorAssociation: "OWNER",
    });
  });

  it("is registered with issues", () => {
    expect(normalizers.get("commit_comment")).toBe(commitComment);
    expect(normalizers.get("issues")).toBe(issues);
  });
});
