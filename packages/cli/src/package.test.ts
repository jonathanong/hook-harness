import { describe, expect, it } from "vitest";

import pkg from "../package.json" with { type: "json" };

describe("package.json", () => {
  it("uses bin paths npm publish keeps", () => {
    // npm 12 publish silently drops bin entries written as "./path".
    for (const target of Object.values(pkg.bin)) {
      expect(target).not.toMatch(/^\.\//);
      expect(pkg.files.some((dir) => target.startsWith(`${dir}/`))).toBe(true);
    }
  });
});
