import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { MAX_STORED_BYTES, packPayload, parsePayloadConfig, unpackPayload } from "./payload.ts";

describe("parsePayloadConfig", () => {
  it("defaults to dropping installation, repository and organization", () => {
    expect(parsePayloadConfig(undefined, undefined)).toEqual({
      drop: ["installation", "repository", "organization"],
      maxBytes: 1_000_000,
    });
  });

  it("keeps everything but installation when the drop list is empty", () => {
    expect(parsePayloadConfig("", "0")).toEqual({ drop: ["installation"], maxBytes: 0 });
    expect(parsePayloadConfig(" sender , installation,", "-1")).toEqual({
      drop: ["installation", "sender"],
      maxBytes: 1_000_000,
    });
  });
});

describe("packPayload", () => {
  const payload = { action: "opened", installation: { id: 1 }, repository: { id: 2 }, x: 3 };

  it("round-trips the pruned payload", () => {
    const packed = packPayload(payload, parsePayloadConfig(undefined, undefined));
    expect(unpackPayload((packed as { payload: Uint8Array }).payload)).toEqual({
      action: "opened",
      x: 3,
    });
  });

  it("reports disabled and oversized payloads", () => {
    expect(packPayload(payload, { drop: [], maxBytes: 0 })).toEqual({ payloadOmitted: "disabled" });
    expect(packPayload(payload, { drop: [], maxBytes: 10 })).toEqual({
      payloadOmitted: "too_large",
    });
    const noise = { blob: randomBytes(MAX_STORED_BYTES).toString("base64") };
    expect(packPayload(noise, { drop: [], maxBytes: 10_000_000 })).toEqual({
      payloadOmitted: "too_large",
    });
  });
});
