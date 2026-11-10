import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { main } from "../main.ts";
import { harness } from "../test-helpers/ctx.ts";
import { mcp, serve } from "./command.ts";

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("hook-harness mcp", () => {
  it("prints help and is registered in the command table", async () => {
    const h = await harness();
    expect(await mcp(["--help"], h.ctx)).toBe(0);
    expect(h.out.join("\n")).toContain("claude mcp add hook-harness -- npx -y hook-harness mcp");
    h.out.length = 0;
    expect(await main(["mcp", "--help"], h.ctx)).toBe(0);
    expect(h.out[0]).toContain("wait_for_events");
  });

  it("speaks MCP on stdout only, logs to stderr, and exits when stdin ends", async () => {
    const h = await harness();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const done = mcp([], h.ctx, stdin, stdout);
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      },
    };
    stdin.write(`${JSON.stringify(init)}\n`);
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    await tick(50);
    stdin.end();
    expect(await done).toBe(0);
    const lines = chunks.join("").trim().split("\n");
    const messages = lines.map((line) => JSON.parse(line) as { id: number; result: any });
    expect(messages.map((m) => m.id)).toEqual([1, 2]);
    expect(messages[0]!.result.serverInfo.name).toBe("hook-harness");
    expect(messages[1]!.result.tools).toHaveLength(3);
    expect(h.out).toEqual([]);
    expect(h.err.join("\n")).toContain("serving on stdio");
  });

  it("shuts down when the process signal aborts", async () => {
    const h = await harness();
    const [, serverSide] = InMemoryTransport.createLinkedPair();
    const done = serve(h.ctx, serverSide);
    await tick(10);
    h.abort();
    expect(await done).toBe(0);
  });
});
