import { z } from "zod";
import { anchorExtent, compareAligned, type ComparedRegion } from "../core/alignment-compare.js";
import { loadFile } from "../core/files.js";
import { defineTool } from "./definition.js";

export const compareInput = {
  files: z.array(z.string()).min(2).describe("Two or more sample files of the same kind"),
  minConstantLength: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Constant runs shorter than this inside variable data are merged into the variable region"),
  minAnchorLength: z
    .number()
    .int()
    .min(1)
    .default(4)
    .describe("Shortest constant run that anchors a header or trailer when looking for size-tracking regions"),
  maxRegions: z.number().int().min(1).max(10000).default(200).describe("Maximum regions to report per alignment"),
};

export interface SizeTrackingRegion {
  offset: number;
  endOffsetFromEnd: number;
  lengths: { file: string; offset: number; length: number }[];
  check: string;
  note: string;
}

export interface AlignedComparison {
  comparedLength: number;
  regions: ComparedRegion[];
  regionsTruncated: boolean;
  constantBytes: number;
  variableBytes: number;
}

export interface CompareOutput {
  samples: { file: string; size: number }[];
  sizes: { min: number; max: number; allEqual: boolean };
  fromStart: AlignedComparison;
  fromEnd: AlignedComparison;
  sizeTracking: SizeTrackingRegion[];
  notes: string[];
}

function aligned(samples: Uint8Array[], length: number, fromEnd: boolean, minConstantLength: number, maxRegions: number): AlignedComparison {
  const regions = compareAligned(samples, length, fromEnd, minConstantLength);
  const total = (kind: string): number =>
    regions.filter((region) => region.kind === kind).reduce((sum, region) => sum + region.length, 0);
  return {
    comparedLength: length,
    regions: regions.slice(0, maxRegions),
    regionsTruncated: regions.length > maxRegions,
    constantBytes: total("constant"),
    variableBytes: total("variable"),
  };
}

function sizeTracking(
  files: string[],
  sizes: number[],
  headerExtent: number,
  trailerExtent: number,
): SizeTrackingRegion[] {
  const minSize = Math.min(...sizes);
  if (new Set(sizes).size < 2 || headerExtent + trailerExtent > minSize) {
    return [];
  }
  const anchored = headerExtent + trailerExtent;
  return [
    {
      offset: headerExtent,
      endOffsetFromEnd: trailerExtent,
      lengths: files.map((file, index) => ({ file, offset: headerExtent, length: (sizes[index] ?? 0) - anchored })),
      check: `length equals file size minus ${anchored} in ${files.length} of ${files.length} samples, with a constant header ending at ${headerExtent} and a constant trailer of ${trailerExtent} bytes`,
      note: "The region between the last constant run anchored at the start and the first constant run anchored at the end grows and shrinks with the file. Look for a length or count field that describes it.",
    },
  ];
}

export function compare(input: z.infer<z.ZodObject<typeof compareInput>>): CompareOutput {
  const loaded = input.files.map((file) => loadFile(file));
  const samples = loaded.map((file) => file.bytes);
  const sizes = samples.map((sample) => sample.length);
  const minSize = Math.min(...sizes);
  const fromStart = aligned(samples, minSize, false, input.minConstantLength, input.maxRegions);
  const fromEnd = aligned(samples, minSize, true, input.minConstantLength, input.maxRegions);
  const headerExtent = anchorExtent(compareAligned(samples, minSize, false, input.minConstantLength), input.minAnchorLength);
  const trailerExtent = anchorExtent(compareAligned(samples, minSize, true, input.minConstantLength), input.minAnchorLength);
  const notes: string[] = [];
  if (new Set(sizes).size > 1) {
    notes.push(`Only the first and last ${minSize} bytes are compared, the size of the smallest sample.`);
  }
  if (samples.length < 3) {
    notes.push("With two samples, about one byte in 256 matches by chance. Add samples to make constant regions meaningful.");
  }
  return {
    samples: input.files.map((file, index) => ({ file, size: sizes[index] ?? 0 })),
    sizes: { min: minSize, max: Math.max(...sizes), allEqual: new Set(sizes).size === 1 },
    fromStart,
    fromEnd,
    sizeTracking: sizeTracking(input.files, sizes, headerExtent, trailerExtent),
    notes,
  };
}

export const compareTool = defineTool({
  name: "compare",
  title: "Compare samples",
  description:
    "Align two or more samples at the start and at the end and report constant regions, variable regions, and the region whose length tracks the file size.",
  inputShape: compareInput,
  run: compare,
});
