import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeClient } from "../client.ts";
import { ev, page } from "../test-helpers/watch.ts";
import { resolveClient } from "./config.ts";
import { NotLoggedInError, OutOfScopeError, RelayError, UnauthorizedError } from "./errors.ts";
import { fetchEventsPage } from "./events.ts";

/** A fetch that answers `response` and records each request URL. */
function relay(response: () => Response) {
  const urls: URL[] = [];
  const fetch = vi.fn(async (input: string | URL | Request) => {
    urls.push(new URL(String(input)));
    return response();
  });
  return { urls, fetch: fetch as unknown as typeof globalThis.fetch };
}

const conn = { url: "https://relay.example/", token: "hh_t", owner: "o" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchEventsPage", () => {
  it("sends only the params it is given and returns the page", async () => {
    const r = relay(() => Response.json(page([ev("a", 1)], "c1")));
    const result = await fetchEventsPage({ ...conn, fetch: r.fetch });
    expect(result).toEqual(page([ev("a", 1)], "c1"));
    expect(r.urls[0]!.href).toBe("https://relay.example/events?owner=o");
  });

  it("maps since, repos, limit, payload and on presets to query params", async () => {
    const r = relay(() => Response.json(page([])));
    await fetchEventsPage({
      ...conn,
      url: "https://relay.example",
      fetch: r.fetch,
      repos: ["o/r"],
      since: new Date(5000),
      limit: 10,
      payload: false,
      filters: [{ event: "push" }],
      on: ["/ship"],
    });
    const params = Object.fromEntries(r.urls[0]!.searchParams);
    expect(params).toMatchObject({ repos: "o/r", after: "5000", limit: "10", payload: "0" });
    expect(JSON.parse(params["filters"]!)).toEqual([
      { event: "push" },
      { event: "issue_comment", action: "created", command: "/ship" },
    ]);
  });

  it("prefers after over since and uses the global fetch by default", async () => {
    const r = relay(() => Response.json(page([])));
    vi.stubGlobal("fetch", r.fetch);
    await fetchEventsPage({ ...conn, after: "123#x", since: new Date(5000) });
    expect(r.urls[0]!.searchParams.get("after")).toBe("123#x");
  });

  it("rejects an unknown preset before calling the relay", async () => {
    const r = relay(() => Response.json(page([])));
    await expect(fetchEventsPage({ ...conn, fetch: r.fetch, on: ["nope"] })).rejects.toThrow(
      new TypeError('unknown preset "nope"'),
    );
    expect(r.urls).toHaveLength(0);
  });

  it("throws UnauthorizedError for 401", async () => {
    const r = relay(() => new Response("", { status: 401 }));
    const error = await fetchEventsPage({ ...conn, fetch: r.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({ status: 401, name: "UnauthorizedError" });
  });

  it("throws OutOfScopeError for 403, with the scopes when the relay names them", async () => {
    const named = relay(() =>
      Response.json({ error: "forbidden", scopes: ["a/*"] }, { status: 403 }),
    );
    await expect(fetchEventsPage({ ...conn, fetch: named.fetch })).rejects.toMatchObject({
      constructor: OutOfScopeError,
      status: 403,
      owner: "o",
      scopes: ["a/*"],
      message: expect.stringContaining("--repos 'a/*,o/*'"),
    });
    const older = relay(() => new Response("forbidden", { status: 403 }));
    await expect(fetchEventsPage({ ...conn, fetch: older.fetch })).rejects.toMatchObject({
      scopes: undefined,
      message: expect.stringContaining("'<current repos>,o/*'"),
    });
  });

  it("throws RelayError with the status for any other failure", async () => {
    const r = relay(() => new Response("", { status: 503 }));
    await expect(fetchEventsPage({ ...conn, fetch: r.fetch })).rejects.toMatchObject({
      constructor: RelayError,
      status: 503,
      message: "relay returned HTTP 503",
    });
  });
});

describe("resolveClient", () => {
  it("reads process.env by default, which overrides client.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hh-client-"));
    await writeClient({ HOOK_HARNESS_CONFIG_DIR: dir }, { url: "https://saved", token: "hh_s" });
    vi.stubEnv("HOOK_HARNESS_CONFIG_DIR", dir);
    vi.stubEnv("HOOK_HARNESS_URL", "");
    vi.stubEnv("HOOK_HARNESS_TOKEN", "hh_env");
    expect(await resolveClient()).toEqual({ url: "https://saved", token: "hh_env" });
  });

  it("throws NotLoggedInError without a URL and token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hh-client-"));
    await expect(resolveClient({ HOOK_HARNESS_CONFIG_DIR: dir })).rejects.toBeInstanceOf(
      NotLoggedInError,
    );
  });
});
