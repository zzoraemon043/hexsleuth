import { decompress } from "lz4js";
import { xxhash32 } from "./xxhash32.js";
import type { DecodedStream } from "./types.js";

const frameMagic = [0x04, 0x22, 0x4d, 0x18];

export function hasLz4Magic(bytes: Uint8Array, offset: number): boolean {
  return frameMagic.every((value, index) => bytes[offset + index] === value);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

export function lz4FrameLength(bytes: Uint8Array, offset: number): number | undefined {
  const flags = bytes[offset + 4];
  if (flags === undefined || flags >> 6 !== 1) {
    return undefined;
  }
  const hasBlockChecksum = (flags & 0x10) !== 0;
  const hasContentSize = (flags & 0x08) !== 0;
  const hasContentChecksum = (flags & 0x04) !== 0;
  const hasDictionary = (flags & 0x01) !== 0;
  const descriptorEnd = offset + 6 + (hasContentSize ? 8 : 0) + (hasDictionary ? 4 : 0);
  if (descriptorEnd >= bytes.length) {
    return undefined;
  }
  const expectedChecksum = (xxhash32(bytes.subarray(offset + 4, descriptorEnd)) >>> 8) & 0xff;
  if (bytes[descriptorEnd] !== expectedChecksum) {
    return undefined;
  }
  let position = descriptorEnd + 1;
  while (position + 4 <= bytes.length) {
    const blockSize = readU32(bytes, position) & 0x7fffffff;
    position += 4;
    if (blockSize === 0) {
      const end = position + (hasContentChecksum ? 4 : 0);
      return end <= bytes.length ? end - offset : undefined;
    }
    position += blockSize + (hasBlockChecksum ? 4 : 0);
  }
  return undefined;
}

export function decodeLz4(bytes: Uint8Array, offset: number): DecodedStream | undefined {
  if (!hasLz4Magic(bytes, offset)) {
    return undefined;
  }
  const length = lz4FrameLength(bytes, offset);
  if (length === undefined) {
    return undefined;
  }
  const output = decompress(bytes.slice(offset, offset + length));
  return {
    method: "lz4",
    offset,
    compressedSize: length,
    output: new Uint8Array(output),
    complete: true,
    evidence: "LZ4 frame magic 04 22 4d 18, the frame descriptor checksum matches, and the blocks decode up to the end mark",
  };
}
