import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import pkg from "../package.json" with { type: "json" };

describe("package.json", () => {
  it("uses bin paths npm publish keeps", () => {
    // npm 12 publish silently drops bin entries written as "./path".
    for (const target of Object.values(pkg.bin)) {
      expect(target).not.toMatch(/^\.\//);
      expect(pkg.files.some((dir) => target.startsWith(`${dir}/`))).toBe(true);
    }
  });

  it("uses export paths Node resolves, inside the published files", () => {
    // Unlike bin, exports targets must start with "./".
    for (const target of Object.values(pkg.exports).flatMap((entry) => Object.values(entry))) {
      expect(target).toMatch(/^\.\//);
      expect(pkg.files.some((dir) => target.startsWith(`./${dir}/`))).toBe(true);
    }
  });

  it("ships the repo's LICENSE, which npm always packs from the package root", () => {
    const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
    expect(read("../LICENSE")).toBe(read("../../../LICENSE"));
  });
});
