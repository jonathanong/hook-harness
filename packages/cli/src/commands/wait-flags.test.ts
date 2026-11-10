import { describe, expect, it } from "vitest";

import { ev, lastLine, page, watchHarness } from "../test-helpers/watch.ts";
import { buildFilters } from "../watch/flags.ts";
import { wait } from "./wait.ts";

const ids = (h: { out: string[] }): string[] =>
  (JSON.parse(h.out.at(-1)!).events as Array<{ id: string }>).map((e) => e.id);

describe("wait filters", () => {
  const events = [
    ev("pr", 1, { prs: [7], authorAssociation: "OWNER", sender: { login: "bot", type: "Bot" } }),
    ev("push", 2, { event: "push" }),
    ev("cmd", 3, { event: "issue_comment", command: "/plan", authorAssociation: "NONE" }),
  ];

  it("flag filters combine as one filter; comma lists and repeats work", async () => {
    const h = await watchHarness([page(events)]);
    await wait(
      [
        "--owner",
        "o",
        "--event",
        "pull_request,push",
        "--event",
        "issue_comment",
        "--pr",
        "7",
        "--settle",
        "0s",
      ],
      h.ctx,
    );
    expect(ids(h)).toEqual(["pr"]);
  });

  it("applies association and sender filters", async () => {
    const h = await watchHarness([page(events)]);
    await wait(
      ["--owner", "o", "--min-association", "OWNER", "--ignore-sender", "nobody", "--settle", "0s"],
      h.ctx,
    );
    expect(ids(h)).toEqual(["pr"]);
    const g = await watchHarness([page(events)]);
    await wait(
      ["--owner", "o", "--ignore-sender", "bot", "--command", "/plan", "--settle", "0s"],
      g.ctx,
    );
    expect(ids(g)).toEqual(["cmd"]);
  });

  it("an event matches if it matches ANY --filter JSON", async () => {
    const h = await watchHarness([page(events)]);
    await wait(
      [
        "--owner",
        "o",
        "--filter",
        '{"event":"push"}',
        "--filter",
        '{"command":["/plan","/fix"]}',
        "--settle",
        "0s",
      ],
      h.ctx,
    );
    expect(ids(h)).toEqual(["push", "cmd"]);
    expect(lastLine(h).gap).toBe(false);
  });

  it("matches every event with no filters", async () => {
    const h = await watchHarness([page(events)]);
    await wait(["--owner", "o", "--settle", "0s"], h.ctx);
    expect(ids(h)).toEqual(["pr", "push", "cmd"]);
  });
});

describe("wait argument errors", () => {
  it("validates flags before polling", async () => {
    const h = await watchHarness([page([])]);
    const cases: Array<[string[], string]> = [
      [[], "--owner is required"],
      [["--owner", "o", "--filter", "{nope"], "not valid JSON"],
      [["--owner", "o", "--filter", "[1]"], "must be a JSON object"],
      [["--owner", "o", "--filter", "null"], "must be a JSON object"],
      [["--owner", "o", "--pr", "x"], 'invalid --pr "x"'],
      [["--owner", "o", "--interval", "0s"], "invalid --interval"],
      [["--owner", "o", "--timeout", "soon"], "invalid --timeout"],
      [["--owner", "o", "--since", "yesterday"], "invalid --since"],
      [["--owner", "o", "--cursor", "../x"], "invalid --cursor name"],
    ];
    for (const [args, message] of cases) await expect(wait(args, h.ctx)).rejects.toThrow(message);
    expect(h.calls.urls).toHaveLength(0);
  });

  it("explains how to log in when no credentials exist", async () => {
    const h = await watchHarness([page([])]);
    delete h.ctx.env.HOOK_HARNESS_URL;
    await expect(wait(["--owner", "o"], h.ctx)).rejects.toThrow("hook-harness login");
  });

  it("prints help", async () => {
    const h = await watchHarness([page([])]);
    expect(await wait(["--help"], h.ctx)).toBe(0);
    expect(h.out[0]).toContain("--after");
    expect(h.out[0]).toContain("exits 0");
  });

  it("buildFilters returns nothing for no flags", () => {
    expect(buildFilters({})).toEqual([]);
  });

  it("--on adds preset filters and --sender matches the sender", async () => {
    const bot = { login: "dependabot[bot]", type: "Bot" };
    const mixed = [
      ev("dep", 1, { event: "pull_request", action: "opened", sender: bot }),
      ev("merged", 2, { event: "pull_request", action: "dequeued", reason: "MERGE" }),
      ev("eject", 3, { event: "pull_request", action: "dequeued", reason: "CI_FAILURE" }),
      ev("cmd", 4, { event: "issue_comment", action: "created", command: "/shepherd" }),
    ];
    const h = await watchHarness([page(mixed), page(mixed)]);
    await wait(
      ["--owner", "o", "--on", "ejection,/shepherd", "--on", "dependabot-pr", "--settle", "0s"],
      h.ctx,
    );
    expect(ids(h)).toEqual(["dep", "eject", "cmd"]);
    expect(buildFilters({ sender: ["dependabot[bot]"] })).toEqual([
      { sender: ["dependabot[bot]"] },
    ]);
    expect(() => buildFilters({ on: ["nope"] })).toThrow(
      /unknown --on "nope"; use one of ejection/,
    );
  });
});
