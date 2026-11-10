import { crc32, deflateRawSync } from "node:zlib";

/** Builds a zip archive containing one deflated file. No dependencies. */
export function zipSingleFile(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name);
  const body = deflateRawSync(data);
  // Fields shared by the local and central headers, from "version needed" to "extra length".
  // DOS time 00:00:00 and date 1980-01-01 keep the archive deterministic.
  const common = Buffer.alloc(26);
  common.writeUInt16LE(20, 0); // version needed
  common.writeUInt16LE(8, 4); // deflate
  common.writeUInt16LE(0x21, 8); // date
  common.writeUInt32LE(crc32(data), 10);
  common.writeUInt32LE(body.length, 14);
  common.writeUInt32LE(data.length, 18);
  common.writeUInt16LE(nameBuf.length, 22);

  const local = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), common, nameBuf, body]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // made by: unix
  common.copy(central, 6);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attributes
  const centralFull = Buffer.concat([central, nameBuf]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralFull.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, centralFull, end]);
}
