import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { zipSingleFile } from "./zip.ts";

describe("zipSingleFile", () => {
  it("writes a readable single-entry archive", () => {
    const data = Buffer.from("export const handler = () => 'hello hello hello hello';\n");
    const zip = zipSingleFile("index.mjs", data);

    // End of central directory.
    const eocd = zip.length - 22;
    expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(zip.readUInt16LE(eocd + 10)).toBe(1);
    const centralOffset = zip.readUInt32LE(eocd + 16);
    expect(zip.readUInt32LE(centralOffset)).toBe(0x02014b50);

    // Local header.
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt16LE(8)).toBe(8);
    const crc = zip.readUInt32LE(14);
    const compressed = zip.readUInt32LE(18);
    expect(zip.readUInt32LE(22)).toBe(data.length);
    expect(crc).toBe(crc32(data));
    const nameLength = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLength).toString()).toBe("index.mjs");
    const body = zip.subarray(30 + nameLength, 30 + nameLength + compressed);
    expect(inflateRawSync(body)).toEqual(data);

    // Central header repeats the sizes and points at offset 0.
    expect(zip.readUInt32LE(centralOffset + 16)).toBe(crc);
    expect(zip.readUInt32LE(centralOffset + 42)).toBe(0);
    expect(zip.readUInt32LE(eocd + 12)).toBe(46 + nameLength);
  });
});
