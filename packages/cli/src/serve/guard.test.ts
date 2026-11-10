import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";

import { UsageError } from "../args.ts";
import { authorized, isLoopback, resolveAccess } from "./guard.ts";
import { filtersFromQuery } from "./query.ts";

describe("filtersFromQuery", () => {
  const filters = (query: string) => filtersFromQuery(new URLSearchParams(query));

  it("accepts presets and a sender, scoped by repo", () => {
    expect(filters("on=/shepherd&sender=dependabot[bot]&repo=o/r")).toEqual([
      { repo: ["o/r"], sender: ["dependabot[bot]"] },
      { repo: ["o/r"], event: "issue_comment", action: "created", command: "/shepherd" },
    ]);
  });

  it("maps params onto the same filter semantics as wait", () => {
    expect(
      filters(
        "event=pull_request&event=push&action=opened&branch=main&command=/plan&reason=CI_FAILURE" +
          "&conclusion=failure&workflow=ci&pr=4&pr=5&minAssociation=MEMBER&ignoreSender=bot",
      ),
    ).toEqual([
      {
        event: ["pull_request", "push"],
        action: ["opened"],
        branch: ["main"],
        command: ["/plan"],
        reason: ["CI_FAILURE"],
        conclusion: ["failure"],
        workflow: ["ci"],
        pr: [4, 5],
        minAssociation: "MEMBER",
        ignoreSenders: ["bot"],
      },
    ]);
  });

  it("ORs filter params and scopes by repo", () => {
    expect(filters("")).toEqual([]);
    expect(filters("repo=o/r,o/s")).toEqual([{ repo: ["o/r", "o/s"] }]);
    expect(
      filters(
        `event=push&repo=o/r&filter=${encodeURIComponent('{"action":"closed"}')}&filter={"repo":"x/y"}`,
      ),
    ).toEqual([
      { repo: ["o/r"], event: ["push"] },
      { repo: ["o/r"], action: "closed" },
      { repo: "x/y" },
    ]);
  });

  it("rejects bad pr and filter values", () => {
    expect(() => filters("pr=x")).toThrow(UsageError);
    expect(() => filters("filter=nope")).toThrow(UsageError);
  });
});

describe("guard", () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as IncomingMessage;

  it("knows loopback hosts", () => {
    for (const host of ["127.0.0.1", "127.9.9.9", "::1", "localhost"]) {
      expect(isLoopback(host)).toBe(true);
    }
    for (const host of ["0.0.0.0", "::", "192.168.1.5", "example.com"]) {
      expect(isLoopback(host)).toBe(false);
    }
  });

  it("defaults to 127.0.0.1:7391 and refuses unsafe binds", () => {
    expect(resolveAccess({}, {})).toEqual({ host: "127.0.0.1", port: 7391, token: undefined });
    expect(resolveAccess({ port: "0", "auth-token": "t" }, {})).toMatchObject({
      port: 0,
      token: "t",
    });
    expect(resolveAccess({}, { HOOK_HARNESS_SERVE_TOKEN: "env" }).token).toBe("env");
    expect(() => resolveAccess({ host: "0.0.0.0" }, {})).toThrow("--allow-remote");
    expect(() => resolveAccess({ host: "0.0.0.0", "allow-remote": true }, {})).toThrow(
      "requires --auth-token",
    );
    expect(
      resolveAccess({ host: "0.0.0.0", "allow-remote": true, "auth-token": "t" }, {}),
    ).toMatchObject({ host: "0.0.0.0", token: "t" });
    expect(() => resolveAccess({ port: "99999" }, {})).toThrow("invalid --port");
    expect(() => resolveAccess({ port: "abc" }, {})).toThrow("invalid --port");
  });

  it("checks bearer tokens in constant time", () => {
    expect(authorized(req({ authorization: "Bearer secret" }), "secret")).toBe(true);
    expect(authorized(req({ authorization: "Bearer wrong" }), "secret")).toBe(false);
    expect(authorized(req({ authorization: "secret" }), "secret")).toBe(false);
    expect(authorized(req({}), "secret")).toBe(false);
  });

  it("without a token requires a loopback Host and no Origin", () => {
    expect(authorized(req({ host: "127.0.0.1:7391" }), undefined)).toBe(true);
    expect(authorized(req({ host: "localhost" }), undefined)).toBe(true);
    expect(authorized(req({ host: "[::1]:7391" }), undefined)).toBe(true);
    expect(authorized(req({ host: "evil.example:7391" }), undefined)).toBe(false);
    expect(authorized(req({}), undefined)).toBe(false);
    expect(authorized(req({ host: "localhost", origin: "https://evil.example" }), undefined)).toBe(
      false,
    );
  });
});
