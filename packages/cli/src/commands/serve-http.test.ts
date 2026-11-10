import { describe, expect, it } from "vitest";

import { gatedSleep, openStream, startDaemon, until } from "../test-helpers/serve.ts";
import { page, watchHarness } from "../test-helpers/watch.ts";
import { decodeCursor, encodeCursor } from "../watch/cursor.ts";
import { writeCursor } from "../watch/store.ts";
import { serve } from "./serve.ts";

describe("serve http surface and guards", () => {
  it("rejects bad requests, unknown paths and methods", async () => {
    const d = await startDaemon([page([], "s0")]);
    expect((await fetch(`${d.url}/events?pr=x`)).status).toBe(400);
    expect((await fetch(`${d.url}/events?after=garbage`)).status).toBe(400);
    expect((await fetch(`${d.url}/nope`)).status).toBe(404);
    expect((await fetch(`${d.url}/healthz`, { method: "POST" })).status).toBe(405);
    expect(
      (await fetch(`${d.url}/healthz`, { headers: { origin: "https://evil.example" } })).status,
    ).toBe(403);
    d.h.abort();
    await d.done;
  });

  it("requires the bearer token when configured", async () => {
    const d = await startDaemon([page([], "s0")], ["--auth-token", "sekret"]);
    expect((await fetch(`${d.url}/healthz`)).status).toBe(401);
    expect(
      (await fetch(`${d.url}/events`, { headers: { authorization: "Bearer nope" } })).status,
    ).toBe(401);
    const ok = await fetch(`${d.url}/healthz`, { headers: { authorization: "Bearer sekret" } });
    expect(ok.status).toBe(200);
    d.h.abort();
    await d.done;
  });

  it("refuses non-loopback hosts without --allow-remote and tokens, before touching the relay", async () => {
    const h = await watchHarness([page([])]);
    await expect(serve(["--owner", "o", "--host", "0.0.0.0"], h.ctx)).rejects.toThrow(
      "--allow-remote",
    );
    await expect(
      serve(["--owner", "o", "--host", "0.0.0.0", "--allow-remote"], h.ctx),
    ).rejects.toThrow("--auth-token");
    expect(h.calls.urls).toHaveLength(0);
  });

  it("prints help and fails clearly when the port is taken", async () => {
    const d = await startDaemon([page([], "s0")]);
    const port = new URL(d.url).port;
    const h = await watchHarness([page([], "s0")]);
    await expect(serve(["--owner", "o", "--port", port], h.ctx)).rejects.toThrow("EADDRINUSE");
    expect(await serve(["--help"], h.ctx)).toBe(0);
    expect(h.out[0]).toContain("Trust model");
    d.h.abort();
    await d.done;
  });

  it("sends a gap with the upstream cursor when nothing is buffered yet", async () => {
    const d = await startDaemon([page([], "s0")]);
    await d.polled(1);
    const stale = await openStream(
      `${d.url}/events?after=${encodeCursor({ sk: "x", seen: ["gone"] })}`,
    );
    await until(() => stale.messages().length === 1);
    const data = JSON.parse((stale.messages()[0] as { data: string }).data) as { cursor: string };
    expect(decodeCursor(data.cursor).sk).toBe("s0");
    d.h.abort();
    await d.done;
  });

  it("starts from a non-numeric saved cursor and binds IPv6 loopback", async () => {
    const h = await watchHarness([page([], "s0")]);
    await writeCursor(h.ctx.env, "odd", encodeCursor({ sk: "not-a-time", seen: [] }));
    const gate = gatedSleep();
    h.ctx.sleep = gate.sleep;
    const done = serve(["--owner", "o", "--port", "0", "--host", "::1", "--cursor", "odd"], h.ctx);
    await until(() => h.out.some((line) => line.includes("listening")));
    const url = /http:\/\/\S+/.exec(h.out[0]!)![0];
    expect(url).toMatch(/^http:\/\/\[::1\]:\d+$/);
    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    h.abort();
    await done;
  });
});
