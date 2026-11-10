import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { tokenHash } from "@hook-harness/relay/keys";

import { sha256Hex } from "./aws/tokens.ts";
import { PARAM_FLAGS } from "./commands/deploy-params.ts";
import { OUTPUTS, REAL_TEMPLATE } from "./test-helpers/ctx.ts";

describe("relay contract", () => {
  it("hashes tokens exactly like the relay", () => {
    for (const token of ["hh_abc", "", "hh_é"]) expect(sha256Hex(token)).toBe(tokenHash(token));
  });

  it("maps every deploy flag to a real template parameter and output", async () => {
    const template = await readFile(REAL_TEMPLATE, "utf8");
    for (const key of Object.values(PARAM_FLAGS)) {
      expect(template).toMatch(new RegExp(`^  ${key}:`, "m"));
    }
    for (const { OutputKey } of OUTPUTS)
      expect(template).toMatch(new RegExp(`^  ${OutputKey}:`, "m"));
  });
});
