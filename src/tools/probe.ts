import { z } from "zod";
import { classifyHighEntropy, entropyBlocks, type EntropyBlock, type HighEntropyRegion } from "../core/entropy-regions.js";
import { roundTo } from "../core/entropy.js";
import { clampRange, loadFile } from "../core/files.js";
import { findPaddingRuns, findRepeatedPatterns, largestPowerOfTwoDividing, type PaddingRun, type RepeatedPattern } from "../core/patterns.js";
import { findMagic, type MagicCandidate } from "../core/signatures.js";
import { findPrintableStrings, type PrintableString } from "../core/strings.js";
import { defineTool } from "./definition.js";

export const probeInput = {
  file: z.string().describe("Path to the file"),
  offset: z.number().int().min(0).default(0).describe("Start of the range to probe"),
  length: z.number().int().min(1).optional().describe("Length of the range to probe; defaults to the rest of the file"),
  blockSize: z.number().int().min(16).max(65536).default(256).describe("Block size for the entropy map"),
  minStringLength: z.number().int().min(2).max(256).default(4).describe("Shortest printable string to report"),
  maxStrings: z.number().int().min(0).max(10000).default(100).describe("Maximum number of strings to report"),
  maxBlocks: z.number().int().min(1).max(100000).default(512).describe("Maximum number of entropy blocks to report"),
};

export interface ProbeOutput {
  file: string;
  size: number;
  range: { offset: number; length: number };
  magic: MagicCandidate[];
  entropy: {
    blockSize: number;
    min: number;
    max: number;
    mean: number;
    blocks: EntropyBlock[];
    blocksTruncated: boolean;
    highEntropyRegions: HighEntropyRegion[];
  };
  strings: PrintableString[];
  stringsTruncated: boolean;
  alignment: { sizeAlignment: number; paddingRuns: PaddingRun[] };
  repeatedPatterns: RepeatedPattern[];
}

function summarize(blocks: EntropyBlock[]): { min: number; max: number; mean: number } {
  if (blocks.length === 0) {
    return { min: 0, max: 0, mean: 0 };
  }
  const values = blocks.map((block) => block.entropy);
  const weightedTotal = blocks.reduce((total, block) => total + block.entropy * block.length, 0);
  const totalLength = blocks.reduce((total, block) => total + block.length, 0);
  return { min: Math.min(...values), max: Math.max(...values), mean: roundTo(weightedTotal / totalLength, 3) };
}

export function probe(input: z.infer<z.ZodObject<typeof probeInput>>): ProbeOutput {
  const file = loadFile(input.file);
  const range = clampRange(file.bytes.length, input.offset, input.length);
  const slice = file.bytes.subarray(range.offset, range.offset + range.length);
  const blocks = entropyBlocks(slice, range.offset, input.blockSize);
  const strings = findPrintableStrings(slice, range.offset, input.minStringLength);
  return {
    file: input.file,
    size: file.bytes.length,
    range,
    magic: findMagic(slice, range.offset),
    entropy: {
      blockSize: input.blockSize,
      ...summarize(blocks),
      blocks: blocks.slice(0, input.maxBlocks),
      blocksTruncated: blocks.length > input.maxBlocks,
      highEntropyRegions: classifyHighEntropy(file.bytes, blocks, input.blockSize),
    },
    strings: strings.slice(0, input.maxStrings),
    stringsTruncated: strings.length > input.maxStrings,
    alignment: {
      sizeAlignment: largestPowerOfTwoDividing(file.bytes.length),
      paddingRuns: findPaddingRuns(slice, range.offset, 4),
    },
    repeatedPatterns: findRepeatedPatterns(slice, range.offset, 4, 12),
  };
}

export const probeTool = defineTool({
  name: "probe",
  title: "Probe a file",
  description:
    "Report size, magic number candidates, entropy per block, printable strings with offsets, alignment, padding and repeated byte patterns. High-entropy regions are classified as compressed or possibly-encrypted; nothing is decrypted.",
  inputShape: probeInput,
  run: probe,
});
