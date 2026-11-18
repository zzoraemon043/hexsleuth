import { decompress } from "lz4js";
import { xxhash32 } from "./xxhash32.js";
import type { DecodedStream } from "./types.js";

const frameMagic = [0x04, 0x22, 0x4d, 0x18];
const blockChecksumFlag = 0x10;

export function hasLz4Magic(bytes: Uint8Array, offset: number): boolean {
  return frameMagic.every((value, index) => bytes[offset + index] === value);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function frameForDecoder(bytes: Uint8Array, offset: number): { input: Uint8Array; length: number } | undefined {
  const flags = bytes[offset + 4];
  if (flags === undefined || flags >> 6 !== 1 || (flags & 0x01) !== 0) {
    return undefined;
  }
  const hasBlockChecksum = (flags & blockChecksumFlag) !== 0;
  const hasContentSize = (flags & 0x08) !== 0;
  const hasContentChecksum = (flags & 0x04) !== 0;
  const descriptorEnd = offset + 6 + (hasContentSize ? 8 : 0);
  if (descriptorEnd >= bytes.length) {
    return undefined;
  }
  const expectedChecksum = (xxhash32(bytes.subarray(offset + 4, descriptorEnd)) >>> 8) & 0xff;
  if (bytes[descriptorEnd] !== expectedChecksum) {
    return undefined;
  }
  let blocks: Uint8Array[] | undefined = hasBlockChecksum ? [] : undefined;
  let position = descriptorEnd + 1;
  while (position + 4 <= bytes.length) {
    const blockHeader = readU32(bytes, position);
    const blockStart = position + 4;
    if (blockHeader === 0) {
      const end = blockStart + (hasContentChecksum ? 4 : 0);
      if (end > bytes.length) {
        return undefined;
      }
      const input = blocks ? frameWithoutBlockChecksums(bytes, offset, descriptorEnd, blocks, position, end) : bytes.subarray(offset, end);
      return { input, length: end - offset };
    }
    const blockSize = blockHeader & 0x7fffffff;
    const blockEnd = blockStart + blockSize;
    if (hasBlockChecksum && (blockEnd + 4 > bytes.length || readU32(bytes, blockEnd) !== xxhash32(bytes.subarray(blockStart, blockEnd)))) {
      return undefined;
    }
    if (blockSize === 0) {
      blocks ??= [bytes.subarray(descriptorEnd + 1, position)];
    } else {
      blocks?.push(bytes.subarray(position, blockEnd));
    }
    position = blockEnd + (hasBlockChecksum ? 4 : 0);
  }
  return undefined;
}

function frameWithoutBlockChecksums(bytes: Uint8Array, offset: number, descriptorEnd: number, blocks: Uint8Array[], endMark: number, end: number): Uint8Array {
  const frame = Buffer.concat([bytes.subarray(offset, descriptorEnd + 1), ...blocks, bytes.subarray(endMark, end)]);
  frame[4] = (frame[4] ?? 0) & ~blockChecksumFlag;
  frame[descriptorEnd - offset] = (xxhash32(frame.subarray(4, descriptorEnd - offset)) >>> 8) & 0xff;
  return frame;
}

export function decodeLz4(bytes: Uint8Array, offset: number): DecodedStream | undefined {
  if (!hasLz4Magic(bytes, offset)) {
    return undefined;
  }
  const frame = frameForDecoder(bytes, offset);
  if (!frame) {
    return undefined;
  }
  const output = decompress(frame.input);
  return {
    method: "lz4",
    offset,
    compressedSize: frame.length,
    output: new Uint8Array(output),
    complete: true,
    evidence: "LZ4 frame magic 04 22 4d 18, the frame descriptor checksum matches, and the blocks decode up to the end mark",
  };
}
