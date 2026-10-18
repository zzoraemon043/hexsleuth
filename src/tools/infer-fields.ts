import { z } from "zod";
import { loadFile } from "../core/files.js";
import type { Finding, FindingKind } from "../infer/finding.js";
import { inferFindings } from "../infer/index.js";
import { defineTool } from "./definition.js";

export const inferFieldsInput = {
  files: z.array(z.string()).min(1).describe("Sample files of the same kind; three or more give meaningful confidence"),
  region: z
    .object({ offset: z.number().int().min(0), length: z.number().int().min(1) })
    .optional()
    .describe("Range, from the start of each file, in which to look for fields; defaults to the first 256 bytes"),
  endScanLength: z
    .number()
    .int()
    .min(0)
    .max(4096)
    .default(64)
    .describe("Also look for fields anchored at the end of each file within this many bytes; 0 disables it"),
  minConfidence: z.number().min(0).max(1).default(0.3).describe("Drop findings below this confidence"),
  maxFindings: z.number().int().min(1).max(1000).default(50).describe("Maximum findings to return"),
};

export interface InferFieldsOutput {
  samples: { file: string; size: number }[];
  scanned: { start: { offset: number; length: number }; endLength: number };
  findings: Finding[];
  countsByKind: Partial<Record<FindingKind, number>>;
  notes: string[];
}

const defaultScanLength = 256;

export function inferFields(input: z.infer<z.ZodObject<typeof inferFieldsInput>>): InferFieldsOutput {
  const samples = input.files.map((file) => ({ file, bytes: loadFile(file).bytes }));
  const region = input.region ?? { offset: 0, length: defaultScanLength };
  const result = inferFindings(samples, {
    plan: { startFrom: region.offset, startTo: region.offset + region.length, endScanLength: input.endScanLength },
    minConfidence: input.minConfidence,
    maxFindings: input.maxFindings,
  });
  const notes = [
    "Confidence combines how many independent checks agree and how many samples support them. Treat every finding as a hypothesis and confirm it with verify_layout.",
  ];
  if (new Set(samples.map((sample) => sample.bytes.length)).size < 2) {
    notes.push("All samples have the same size, so length fields cannot be related to the file size.");
  }
  return {
    samples: samples.map((sample) => ({ file: sample.file, size: sample.bytes.length })),
    scanned: { start: region, endLength: input.endScanLength },
    findings: result.findings,
    countsByKind: result.countsByKind,
    notes,
  };
}

export const inferFieldsTool = defineTool({
  name: "infer_fields",
  title: "Infer fields",
  description:
    "Propose candidate magic, length, record-chain, count, offset, version and endianness fields. Every finding lists the supporting samples, byte ranges, the check that produced it and a confidence from 0 to 1.",
  inputShape: inferFieldsInput,
  run: inferFields,
});
