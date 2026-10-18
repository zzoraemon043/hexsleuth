import { findStreamsInWindow, type DecodedStream } from "./compression.js";
import { highEntropyThreshold, roundTo, shannonEntropy } from "./entropy.js";

export interface EntropyBlock {
  offset: number;
  length: number;
  entropy: number;
}

export interface HighEntropyRegion {
  offset: number;
  length: number;
  meanEntropy: number;
  classification: "compressed" | "possibly-encrypted";
  compression?: { method: string; offset: number; compressedSize: number; decompressedSize: number; complete: boolean };
  note: string;
}

export function entropyBlocks(bytes: Uint8Array, baseOffset: number, blockSize: number): EntropyBlock[] {
  const blocks: EntropyBlock[] = [];
  for (let start = 0; start < bytes.length; start += blockSize) {
    const block = bytes.subarray(start, start + blockSize);
    blocks.push({ offset: baseOffset + start, length: block.length, entropy: roundTo(shannonEntropy(block), 3) });
  }
  return blocks;
}

function mergeHighBlocks(blocks: EntropyBlock[]): EntropyBlock[][] {
  const groups: EntropyBlock[][] = [];
  let current: EntropyBlock[] = [];
  for (const block of blocks) {
    const isHigh = block.length >= 32 && block.entropy >= highEntropyThreshold(block.length);
    if (isHigh) {
      current.push(block);
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

const encryptedNote =
  "High entropy that no supported compression explains. Reported as possibly-encrypted; hexsleuth does not attempt decryption, key search or XOR guessing. Raw deflate has no header, so run detect_compression at a known stream offset if a raw deflate stream is suspected.";

function compressedSegment(stream: DecodedStream, start: number, end: number): HighEntropyRegion {
  const offset = Math.max(start, stream.offset);
  const segmentEnd = Math.min(end, stream.offset + stream.compressedSize);
  return {
    offset,
    length: segmentEnd - offset,
    meanEntropy: 0,
    classification: "compressed",
    compression: {
      method: stream.method,
      offset: stream.offset,
      compressedSize: stream.compressedSize,
      decompressedSize: stream.output.length,
      complete: stream.complete,
    },
    note: stream.evidence,
  };
}

function encryptedSegment(
  fileBytes: Uint8Array,
  offset: number,
  end: number,
  interruptedBefore?: DecodedStream,
): HighEntropyRegion | undefined {
  const gap = fileBytes.subarray(offset, end);
  const entropy = shannonEntropy(gap);
  if (gap.length < minimumGapLength || entropy < highEntropyThreshold(gap.length)) {
    return undefined;
  }
  const continuationHint = interruptedBefore
    ? ` It follows an interrupted ${interruptedBefore.method} stream that starts at ${interruptedBefore.offset}, so it may be the continuation of that stream stored in another chunk.`
    : "";
  return {
    offset,
    length: gap.length,
    meanEntropy: roundTo(entropy, 3),
    classification: "possibly-encrypted",
    note: encryptedNote + continuationHint,
  };
}

const minimumGapLength = 64;

function segmentGroup(fileBytes: Uint8Array, start: number, end: number, blockSize: number): HighEntropyRegion[] {
  const streams = findStreamsInWindow(fileBytes, start - blockSize, end).filter(
    (stream) => stream.offset < end && stream.offset + stream.compressedSize > start,
  );
  const segments: HighEntropyRegion[] = [];
  let cursor = start;
  let previous: DecodedStream | undefined;
  for (const stream of streams) {
    const gapEnd = Math.max(cursor, stream.offset);
    const gap = encryptedSegment(fileBytes, cursor, Math.min(gapEnd, end), previous?.complete === false ? previous : undefined);
    if (gap) {
      segments.push(gap);
    }
    const segment = compressedSegment(stream, start, end);
    segment.meanEntropy = roundTo(shannonEntropy(fileBytes.subarray(segment.offset, segment.offset + segment.length)), 3);
    segments.push(segment);
    cursor = Math.max(cursor, stream.offset + stream.compressedSize);
    previous = stream;
  }
  if (cursor < end) {
    const tail = encryptedSegment(fileBytes, cursor, end, previous?.complete === false ? previous : undefined);
    if (tail) {
      segments.push(tail);
    }
  }
  return segments;
}

export function classifyHighEntropy(fileBytes: Uint8Array, blocks: EntropyBlock[], blockSize: number): HighEntropyRegion[] {
  return mergeHighBlocks(blocks).flatMap((group) => {
    const start = group[0]?.offset ?? 0;
    const last = group.at(-1);
    const end = (last?.offset ?? 0) + (last?.length ?? 0);
    return segmentGroup(fileBytes, start, end, blockSize);
  });
}
