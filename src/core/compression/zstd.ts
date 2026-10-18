import * as zlib from "node:zlib";
import { decompress as decompressPortable } from "fzstd";
import type { DecodedStream } from "./types.js";

const frameMagic = [0x28, 0xb5, 0x2f, 0xfd];
const blockTypeReserved = 3;
const blockTypeRle = 1;

export function hasZstdMagic(bytes: Uint8Array, offset: number): boolean {
  return frameMagic.every((value, index) => bytes[offset + index] === value);
}

function headerLength(descriptor: number): number {
  const contentSizeFlag = descriptor >> 6;
  const singleSegment = (descriptor & 0x20) !== 0;
  const dictionarySizes = [0, 1, 2, 4];
  const contentSizes = [singleSegment ? 1 : 0, 2, 4, 8];
  return 1 + (singleSegment ? 0 : 1) + (dictionarySizes[descriptor & 0x03] ?? 0) + (contentSizes[contentSizeFlag] ?? 0);
}

export function zstdFrameLength(bytes: Uint8Array, offset: number): number | undefined {
  const descriptor = bytes[offset + 4];
  if (descriptor === undefined || (descriptor & 0x08) !== 0) {
    return undefined;
  }
  let position = offset + 4 + headerLength(descriptor);
  while (position + 3 <= bytes.length) {
    const header = (bytes[position] ?? 0) | ((bytes[position + 1] ?? 0) << 8) | ((bytes[position + 2] ?? 0) << 16);
    const isLast = (header & 1) === 1;
    const blockType = (header >> 1) & 0x03;
    if (blockType === blockTypeReserved) {
      return undefined;
    }
    position += 3 + (blockType === blockTypeRle ? 1 : header >> 3);
    if (isLast) {
      const end = position + ((descriptor & 0x04) !== 0 ? 4 : 0);
      return end <= bytes.length ? end - offset : undefined;
    }
  }
  return undefined;
}

type ZstdDecompress = (input: Uint8Array) => Uint8Array;

function builtInDecompress(): ZstdDecompress | undefined {
  const candidate = (zlib as unknown as { zstdDecompressSync?: (input: Uint8Array) => Buffer }).zstdDecompressSync;
  return candidate ? (input) => new Uint8Array(candidate(input)) : undefined;
}

const decompressFrame: ZstdDecompress = builtInDecompress() ?? ((input) => decompressPortable(input));

export function decodeZstd(bytes: Uint8Array, offset: number): DecodedStream | undefined {
  if (!hasZstdMagic(bytes, offset)) {
    return undefined;
  }
  const length = zstdFrameLength(bytes, offset);
  if (length === undefined) {
    return undefined;
  }
  return {
    method: "zstd",
    offset,
    compressedSize: length,
    output: decompressFrame(bytes.slice(offset, offset + length)),
    complete: true,
    evidence: "Zstandard frame magic 28 b5 2f fd, the block headers walk to the last block, and the frame decompresses",
  };
}
