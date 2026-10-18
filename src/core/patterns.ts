import { toAsciiPreview, toHex } from "./hex.js";

export interface PaddingRun {
  offset: number;
  length: number;
  byte: number;
  endAlignment: number;
}

export interface RepeatedPattern {
  bytes: string;
  ascii: string;
  count: number;
  offsets: number[];
}

const maxAlignment = 4096;

export function largestPowerOfTwoDividing(value: number): number {
  if (value === 0) {
    return maxAlignment;
  }
  let alignment = 1;
  while (alignment < maxAlignment && value % (alignment * 2) === 0) {
    alignment *= 2;
  }
  return alignment;
}

export function findPaddingRuns(bytes: Uint8Array, baseOffset: number, minLength: number): PaddingRun[] {
  const runs: PaddingRun[] = [];
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index] ?? 0;
    let end = index + 1;
    while (end < bytes.length && bytes[end] === byte) {
      end += 1;
    }
    if ((byte === 0x00 || byte === 0xff) && end - index >= minLength) {
      runs.push({ offset: baseOffset + index, length: end - index, byte, endAlignment: largestPowerOfTwoDividing(baseOffset + end) });
    }
    index = end;
  }
  return runs;
}

function isUniform(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === bytes[0]);
}

export function findRepeatedPatterns(bytes: Uint8Array, baseOffset: number, width: number, limit: number): RepeatedPattern[] {
  const occurrences = new Map<string, number[]>();
  for (let index = 0; index + width <= bytes.length; index += 1) {
    const gram = bytes.subarray(index, index + width);
    if (isUniform(gram)) {
      continue;
    }
    const key = toHex(gram);
    const offsets = occurrences.get(key) ?? [];
    const previous = offsets.at(-1);
    if (previous === undefined || index - previous >= width) {
      offsets.push(index);
      occurrences.set(key, offsets);
    }
  }
  return [...occurrences.entries()]
    .filter(([, offsets]) => offsets.length >= 2)
    .sort(([, left], [, right]) => right.length - left.length || (left[0] ?? 0) - (right[0] ?? 0))
    .slice(0, limit)
    .map(([key, offsets]) => {
      const first = offsets[0] ?? 0;
      return {
        bytes: key,
        ascii: toAsciiPreview(bytes.subarray(first, first + width)),
        count: offsets.length,
        offsets: offsets.slice(0, 16).map((offset) => baseOffset + offset),
      };
    });
}
