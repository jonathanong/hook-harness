import { describe, expect, it } from "vitest";

import { associationAtLeast, branchOf, emptyEnvelope, matches } from "./index.ts";

const base = { id: "d1", receivedAt: "2026-11-09T00:00:00.000Z", repo: "o/r" };

describe("associationAtLeast", () => {
  it("ranks associations", () => {
    expect(associationAtLeast("OWNER", "MEMBER")).toBe(true);
    expect(associationAtLeast("MEMBER", "MEMBER")).toBe(true);
    expect(associationAtLeast("CONTRIBUTOR", "MEMBER")).toBe(false);
  });

  it("rejects missing or unknown values", () => {
    expect(associationAtLeast(null, "MEMBER")).toBe(false);
    expect(associationAtLeast("ROBOT", "MEMBER")).toBe(false);
    expect(associationAtLeast("OWNER", "ROBOT")).toBe(false);
  });
});

describe("branchOf", () => {
  it("uses baseRef for PR events and headRef otherwise", () => {
    expect(
      branchOf(emptyEnvelope({ ...base, event: "pull_request", baseRef: "main", headRef: "f" })),
    ).toBe("main");
    expect(
      branchOf(emptyEnvelope({ ...base, event: "workflow_run", baseRef: "x", headRef: "main" })),
    ).toBe("main");
  });
});

describe("matches", () => {
  const dequeued = emptyEnvelope({
    ...base,
    event: "pull_request",
    action: "dequeued",
    reason: "CI_FAILURE",
    baseRef: "main",
    prs: [42],
    sender: { login: "alice", type: "User" },
    authorAssociation: "MEMBER",
  });

  it("matches an empty filter", () => {
    expect(matches(dequeued, {})).toBe(true);
  });

  it("matches scalar and array fields", () => {
    expect(
      matches(dequeued, {
        event: "pull_request",
        action: ["dequeued"],
        reason: ["CI_FAILURE", "CI_TIMEOUT"],
      }),
    ).toBe(true);
    expect(matches(dequeued, { reason: "CI_TIMEOUT" })).toBe(false);
    expect(matches(dequeued, { conclusion: "failure" })).toBe(false);
    expect(matches(dequeued, { branch: "main", repo: "o/r" })).toBe(true);
  });

  it("matches a command only when the envelope has one", () => {
    const plan = emptyEnvelope({ ...base, event: "issue_comment", command: "/plan" });
    expect(matches(plan, { command: "/plan" })).toBe(true);
    expect(matches(plan, { command: ["/fix", "/plan"] })).toBe(true);
    expect(matches(plan, { command: "/fix" })).toBe(false);
    const plain = emptyEnvelope({ ...base, event: "issue_comment" });
    expect(matches(plain, { command: "/plan" })).toBe(false);
    expect(matches(plain, {})).toBe(true);
  });

  it("matches PR numbers", () => {
    expect(matches(dequeued, { pr: 42 })).toBe(true);
    expect(matches(dequeued, { pr: [1, 2] })).toBe(false);
  });

  it("matches sha against headSha and ref against headRef or baseRef", () => {
    const pr = emptyEnvelope({
      ...base,
      event: "pull_request",
      headSha: "abc",
      headRef: "feat",
      baseRef: "main",
    });
    expect(matches(pr, { sha: "abc" })).toBe(true);
    expect(matches(pr, { sha: ["def"] })).toBe(false);
    expect(matches(pr, { ref: "feat" })).toBe(true);
    expect(matches(pr, { ref: ["main"] })).toBe(true);
    expect(matches(pr, { ref: "other" })).toBe(false);
    expect(matches(emptyEnvelope({ ...base, event: "status" }), { sha: "abc", ref: "x" })).toBe(
      false,
    );
  });

  it("applies association and sender filters", () => {
    expect(matches(dequeued, { minAssociation: "OWNER" })).toBe(false);
    expect(matches(dequeued, { minAssociation: "COLLABORATOR" })).toBe(true);
    expect(matches(dequeued, { ignoreSenders: ["alice"] })).toBe(false);
    expect(matches(dequeued, { ignoreSenders: ["bob"] })).toBe(true);
    expect(matches(emptyEnvelope({ ...base, event: "push" }), { ignoreSenders: ["bob"] })).toBe(
      true,
    );
  });
});
