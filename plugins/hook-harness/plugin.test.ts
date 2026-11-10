import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootUrl = new URL("../../", import.meta.url);

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(path, rootUrl), "utf8"));
}

const server = { command: "npx", args: ["-y", "hook-harness", "mcp"] };

describe("plugin manifests", () => {
  it("launches `hook-harness mcp` from both MCP configs", () => {
    expect(readJson("plugins/hook-harness/.mcp.json")["hook-harness"]).toEqual(server);
    expect(readJson("plugins/hook-harness/.codex.mcp.json").mcpServers["hook-harness"]).toEqual(
      server,
    );
  });

  it("registers skills and MCP config in each manifest", () => {
    const root = readJson(".claude-plugin/plugin.json");
    const claude = readJson("plugins/hook-harness/.claude-plugin/plugin.json");
    const codex = readJson("plugins/hook-harness/.codex-plugin/plugin.json");

    expect(root.skills).toBe("./plugins/hook-harness/skills/");
    expect(root.mcpServers).toBe("./plugins/hook-harness/.mcp.json");
    expect(claude.skills).toBe("./skills/");
    expect(claude.mcpServers).toBe("./.mcp.json");
    expect(codex.skills).toBe("./skills/");
    expect(codex.mcpServers).toBe("./.codex.mcp.json");
    for (const manifest of [root, claude, codex]) {
      expect(manifest.name).toBe("hook-harness");
      expect(manifest.license).toBe("MIT");
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    }
    expect(codex.interface.displayName).toBe("hook-harness");
    expect(codex.interface.defaultPrompt.length).toBeGreaterThan(0);
  });

  it("points every marketplace at the plugin", () => {
    const claude = readJson(".claude-plugin/marketplace.json");
    const codex = readJson(".agents/plugins/marketplace.json");
    const npm = readJson("marketplace.json");

    expect(claude.plugins).toEqual([
      expect.objectContaining({ name: "hook-harness", source: "./plugins/hook-harness" }),
    ]);
    expect(codex.plugins).toEqual([
      expect.objectContaining({
        name: "hook-harness",
        source: { source: "local", path: "./plugins/hook-harness" },
      }),
    ]);
    expect(npm).toEqual(
      expect.objectContaining({ source: { source: "npm", package: "hook-harness" } }),
    );
  });
});

describe("skill", () => {
  const text = readFileSync(
    new URL("plugins/hook-harness/skills/hook-harness/SKILL.md", rootUrl),
    "utf8",
  );
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const frontmatter = Object.fromEntries(
    (match?.[1] ?? "").split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i), line.slice(i + 1).trim()];
    }),
  );

  it("has parseable frontmatter with a name and description", () => {
    expect(match).not.toBeNull();
    expect(frontmatter.name).toBe("hook-harness");
    expect(frontmatter.description?.length).toBeGreaterThan(20);
    expect(frontmatter["allowed-tools"]).toContain("mcp__plugin_hook-harness_hook-harness");
  });

  it("contains every filter example as valid JSON", () => {
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const block of blocks) expect(() => JSON.parse(block)).not.toThrow();
  });
});
