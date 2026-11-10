import { describe, expect, it } from "vitest";

import { emptyEnvelope, matches, preset, type Envelope } from "./index.ts";

const base = { id: "d1", receivedAt: "2026-11-09T00:00:00.000Z", repo: "o/r", event: "push" };
const on = (name: string, over: Partial<Envelope>) =>
  matches({ ...emptyEnvelope(base), ...over }, preset(name)!);

describe("presets", () => {
  it("ejection matches a failed dequeue but not a merge", () => {
    const dequeued = { event: "pull_request", action: "dequeued" };
    expect(on("ejection", { ...dequeued, reason: "CI_FAILURE" })).toBe(true);
    expect(on("ejection", { ...dequeued, reason: "MERGE" })).toBe(false);
    expect(on("ejection", { ...dequeued, reason: "MANUAL" })).toBe(false);
  });

  it("main-failure matches a failed workflow run or check suite on main only", () => {
    const run = { event: "workflow_run", action: "completed", conclusion: "failure" };
    expect(on("main-failure", { ...run, headRef: "main" })).toBe(true);
    expect(on("main-failure", { ...run, headRef: "feature" })).toBe(false);
    const suite = { ...run, event: "check_suite", headRef: "main" };
    expect(on("main-failure", suite)).toBe(true);
    expect(on("main-failure", { ...suite, conclusion: "success" })).toBe(false);
  });

  it("dependabot-pr matches a PR Dependabot opened", () => {
    const pr = { event: "pull_request", action: "opened" };
    const bot = { login: "dependabot[bot]", type: "Bot" };
    expect(on("dependabot-pr", { ...pr, sender: bot })).toBe(true);
    expect(on("dependabot-pr", { ...pr, sender: { login: "me", type: "User" } })).toBe(false);
    expect(on("dependabot-pr", pr)).toBe(false);
  });

  it("a slash command matches a new comment with that command", () => {
    const comment = { event: "issue_comment", action: "created", command: "/shepherd" };
    expect(on("/Shepherd", comment)).toBe(true);
    expect(on("/shepherd", { ...comment, action: "edited" })).toBe(false);
  });

  it("label:<name> matches that label being added", () => {
    expect(on("label:needs-review", { action: "labeled", label: "needs-review" })).toBe(true);
    expect(on("label:needs-review", { action: "unlabeled", label: "needs-review" })).toBe(false);
    expect(on("label:needs-review", { action: "labeled", label: "bug" })).toBe(false);
    expect(on("label:needs-review", { action: "labeled" })).toBe(false);
  });

  it("review-requested matches any or a specific requested reviewer", () => {
    const req = { event: "pull_request", action: "review_requested", requestedReviewer: "core" };
    expect(on("review-requested", req)).toBe(true);
    expect(on("review-requested:core", req)).toBe(true);
    expect(on("review-requested:other", req)).toBe(false);
  });

  it("unknown names and inherited keys are not presets", () => {
    expect(preset("label:")).toBeUndefined();
    expect(preset("nope:x")).toBeUndefined();
    expect(preset("nope")).toBeUndefined();
    expect(preset("toString")).toBeUndefined();
    expect(preset("/")).toBeUndefined();
  });
});
