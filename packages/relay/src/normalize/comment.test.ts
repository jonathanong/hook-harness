import { describe, expect, it } from "vitest";

import { ctx, fixture } from "../test-helpers/fixture.ts";
import type { Payload } from "../types.ts";
import { issueComment } from "./comment.ts";

describe("issueComment", () => {
  const body = (text: string | null) => (p: Payload) => (p.comment.body = text);

  it("stores a command comment on a PR with provenance and no text", () => {
    const envelope = issueComment(fixture("issue_comment.created"), ctx);
    expect(envelope).toMatchObject({
      event: "issue_comment",
      action: "created",
      command: "/plan",
      commentId: 555,
      issue: 7,
      prs: [7],
      author: { login: "erin", type: "User" },
      sender: { login: "erin", type: "User" },
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

  it("stores comments without a command with a null command", () => {
    for (const text of ["", "   ", "hi /plan", "/deploy!", "//x", "/", "plain text", null]) {
      const envelope = issueComment(fixture("issue_comment.created", body(text)), ctx);
      expect(envelope).toMatchObject({ command: null, commentId: 555 });
    }
  });

  it("parses any slash command token, lowercased, from the first token", () => {
    const command = (text: string) =>
      issueComment(fixture("issue_comment.created", body(text)), ctx)?.command;
    expect(command("/deploy now")).toBe("/deploy");
    expect(command("\n/Fix_it-2 please")).toBe("/fix_it-2");
  });

  it("stores edited comments with their command", () => {
    const envelope = issueComment(
      fixture("issue_comment.created", (p) => (p.action = "edited")),
      ctx,
    );
    expect(envelope).toMatchObject({ action: "edited", command: "/plan" });
  });

  it("stores deleted comments without a command", () => {
    const envelope = issueComment(
      fixture("issue_comment.created", (p) => (p.action = "deleted")),
      ctx,
    );
    expect(envelope).toMatchObject({ action: "deleted", command: null, commentId: 555 });
  });

  it("reports the comment author apart from the sender", () => {
    const envelope = issueComment(
      fixture("issue_comment.created", (p) => {
        p.action = "deleted";
        p.sender = { login: "mod", type: "User" };
      }),
      ctx,
    );
    expect(envelope?.sender).toEqual({ login: "mod", type: "User" });
    expect(envelope?.author).toEqual({ login: "erin", type: "User" });
  });

  it("has a null author when GitHub gives no user", () => {
    const envelope = issueComment(
      fixture("issue_comment.created", (p) => delete p.comment.user),
      ctx,
    );
    expect(envelope?.author).toBeNull();
  });
});
