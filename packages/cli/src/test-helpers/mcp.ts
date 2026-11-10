import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createServer } from "../mcp/server.ts";
import { watchHarness, type Step } from "./watch.ts";

export const START = Date.parse("2026-11-09T00:00:00Z");

/** A relay-backed harness plus an MCP client linked to the server in-process. */
export async function mcpHarness(steps: Step[]) {
  const h = await watchHarness(steps);
  const server = createServer(h.ctx);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { ...h, client, server, call, close: () => client.close() };
}

export const textOf = (result: CallToolResult): string =>
  (result.content[0] as { text: string }).text;

export const jsonOf = (result: CallToolResult): Record<string, unknown> =>
  JSON.parse(textOf(result)) as Record<string, unknown>;
