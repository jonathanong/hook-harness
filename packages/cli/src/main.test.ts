import { describe, expect, it } from "vitest";

import { UsageError } from "./args.ts";
import { createClients } from "./aws/clients.ts";
import { defaultCtx } from "./ctx.ts";
import { main } from "./main.ts";
import { harness } from "./test-helpers/ctx.ts";

describe("main", () => {
  it("prints usage with no command (exit 1) and for help (exit 0)", async () => {
    const h = await harness();
    expect(await main([], h.ctx)).toBe(1);
    expect(await main(["--help"], h.ctx)).toBe(0);
    expect(await main(["-h"], h.ctx)).toBe(0);
    expect(await main(["help"], h.ctx)).toBe(0);
    expect(h.out).toHaveLength(4);
    expect(h.out[0]).toContain("Commands:");
  });

  it("rejects unknown commands, including prototype names", async () => {
    const h = await harness();
    expect(await main(["nope"], h.ctx)).toBe(2);
    expect(await main(["toString"], h.ctx)).toBe(2);
    expect(h.err[0]).toContain('unknown command "nope"');
  });

  it("dispatches extra commands and maps errors to exit codes", async () => {
    const h = await harness();
    const extra = {
      run: async (args: string[]) => args.length,
      usage: async () => {
        throw new UsageError("bad");
      },
      boom: async () => {
        throw new Error("boom");
      },
      weird: async () => {
        throw "str";
      },
    };
    expect(await main(["run", "a", "b"], h.ctx, extra)).toBe(2);
    expect(await main(["usage"], h.ctx, extra)).toBe(2);
    expect(await main(["boom"], h.ctx, extra)).toBe(1);
    expect(await main(["weird"], h.ctx, extra)).toBe(1);
    expect(h.err).toEqual(["error: bad", "error: boom", "error: str"]);
  });

  it("turns bad flags into usage errors", async () => {
    const h = await harness();
    expect(await main(["status", "--nope"], h.ctx)).toBe(2);
    expect(h.err[0]).toContain("Unknown option");
  });
});

describe("defaultCtx", () => {
  it("points at the relay package and honours the wait override", () => {
    const ctx = defaultCtx({ HOOK_HARNESS_MAX_WAIT: "42" });
    expect(ctx.paths.template).toMatch(/packages[\\/]relay[\\/]template\.yaml$/);
    expect(ctx.paths.bundle).toMatch(/packages[\\/]relay[\\/]dist[\\/]index\.mjs$/);
    expect(ctx.maxWaitSeconds).toBe(42);
    expect(defaultCtx({}).maxWaitSeconds).toBe(900);
    expect(ctx.randomBytes(4)).toHaveLength(4);
    expect(ctx.now()).toBeInstanceOf(Date);
  });

  it("forwards output and fetch", async () => {
    const ctx = defaultCtx({});
    const globals = globalThis as { fetch: typeof fetch };
    const realFetch = globals.fetch;
    globals.fetch = async () => new Response("ok");
    const seen: unknown[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (line: unknown) => seen.push(line);
    console.error = (line: unknown) => seen.push(line);
    try {
      ctx.out("a");
      ctx.err("b");
      expect(await (await ctx.fetch("https://x")).text()).toBe("ok");
    } finally {
      console.log = log;
      console.error = error;
      globals.fetch = realFetch;
    }
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("createClients", () => {
  it("applies region and profile", async () => {
    const env: NodeJS.ProcessEnv = {};
    const clients = createClients({ region: "eu-west-1", profile: "dev" }, env);
    expect(env.AWS_PROFILE).toBe("dev");
    expect(await clients.cfn.config.region()).toBe("eu-west-1");
    const bare = createClients({}, env);
    expect(bare.lambda).toBeDefined();
  });

  it("is wired into defaultCtx", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(defaultCtx(env).clients({ region: "us-east-1" }).ddb).toBeDefined();
  });
});
