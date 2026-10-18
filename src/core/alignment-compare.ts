import { toHex } from "./hex.js";

export type RegionKind = "constant" | "variable";

export interface ComparedRegion {
  kind: RegionKind;
  offset: number;
  length: number;
  bytes?: string;
  values?: string[];
}

export type ByteAt = (sample: Uint8Array, position: number) => number;

export const byteFromStart: ByteAt = (sample, position) => sample[position] ?? -1;
export const byteFromEnd: ByteAt = (sample, position) => sample[sample.length - 1 - position] ?? -1;

const previewLength = 16;

function isConstantAt(samples: Uint8Array[], position: number, byteAt: ByteAt): boolean {
  const reference = byteAt(samples[0] ?? new Uint8Array(0), position);
  return samples.every((sample) => byteAt(sample, position) === reference);
}

function classifyPositions(samples: Uint8Array[], length: number, byteAt: ByteAt): RegionKind[] {
  return Array.from({ length }, (_, position) => (isConstantAt(samples, position, byteAt) ? "constant" : "variable"));
}

function absorbShortConstants(kinds: RegionKind[], minConstantLength: number): RegionKind[] {
  const output = [...kinds];
  let position = 0;
  while (position < output.length) {
    let end = position + 1;
    while (end < output.length && output[end] === output[position]) {
      end += 1;
    }
    const isInterior = position > 0 && end < output.length;
    if (output[position] === "constant" && isInterior && end - position < minConstantLength) {
      output.fill("variable", position, end);
    }
    position = end;
  }
  return output;
}

function sliceFor(sample: Uint8Array, offset: number, length: number, fromEnd: boolean): Uint8Array {
  if (!fromEnd) {
    return sample.subarray(offset, offset + length);
  }
  const end = sample.length - offset;
  return sample.subarray(Math.max(0, end - length), end);
}

export function compareAligned(
  samples: Uint8Array[],
  length: number,
  fromEnd: boolean,
  minConstantLength: number,
): ComparedRegion[] {
  const byteAt = fromEnd ? byteFromEnd : byteFromStart;
  const kinds = absorbShortConstants(classifyPositions(samples, length, byteAt), minConstantLength);
  const regions: ComparedRegion[] = [];
  let position = 0;
  while (position < kinds.length) {
    const kind = kinds[position] ?? "variable";
    let end = position + 1;
    while (end < kinds.length && kinds[end] === kind) {
      end += 1;
    }
    const regionLength = end - position;
    const region: ComparedRegion = { kind, offset: position, length: regionLength };
    const shown = Math.min(regionLength, previewLength);
    if (kind === "constant") {
      region.bytes = toHex(sliceFor(samples[0] ?? new Uint8Array(0), fromEnd ? end - shown : position, shown, fromEnd));
    } else {
      region.values = samples.map((sample) => toHex(sliceFor(sample, fromEnd ? end - shown : position, shown, fromEnd)));
    }
    regions.push(region);
    position = end;
  }
  return regions;
}

export function anchorExtent(regions: ComparedRegion[], minAnchorLength: number): number {
  let extent = 0;
  for (const region of regions) {
    if (region.kind === "constant" && region.length >= minAnchorLength) {
      extent = region.offset + region.length;
    }
  }
  return extent;
}
