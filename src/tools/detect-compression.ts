import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { compressionMethods, signatureAt, tryDecode, type CompressionMethod, type DecodedStream } from "../core/compression/index.js";
import { highEntropyThreshold, roundTo, shannonEntropy } from "../core/entropy.js";
import { clampRange, loadFile } from "../core/files.js";
import { toHex } from "../core/hex.js";
import { defineTool } from "./definition.js";

export const detectCompressionInput = {
  file: z.string().describe("Path to the file"),
  offset: z.number().int().min(0).default(0).describe("Offset where a compressed stream may start"),
  length: z.number().int().min(1).optional().describe("Limit the bytes considered, starting at offset"),
  method: z
    .enum(["auto", ...compressionMethods])
    .default("auto")
    .describe("Compression to test; auto tries every method with a signature and then raw deflate"),
  workDir: z.string().default(".hexsleuth-work").describe("Directory for decompressed output"),
  writeOutput: z.boolean().default(true).describe("Write decompressed bytes to the work directory"),
};

export type Verdict = "compressed" | "possibly-encrypted" | "not-compressed";

export interface DetectedStream {
  method: CompressionMethod;
  offset: number;
  compressedSize: number;
  decompressedSize: number;
  complete: boolean;
  evidence: string;
  outputEntropy: number;
  outputPreview: string;
  outputPath?: string;
}

export interface DetectCompressionOutput {
  file: string;
  offset: number;
  consideredLength: number;
  entropy: number;
  tried: CompressionMethod[];
  verdict: Verdict;
  detected: DetectedStream[];
  note: string;
}

const entropySampleLength = 4096;
const minimumRawDeflateInput = 16;

function methodsToTry(bytes: Uint8Array, offset: number, method: z.infer<typeof detectCompressionInput.method>): CompressionMethod[] {
  if (method !== "auto") {
    return [method];
  }
  const signature = signatureAt(bytes, offset);
  return signature ? [signature, "deflate-raw"] : ["deflate-raw"];
}

function plausibleRawDeflate(stream: DecodedStream): boolean {
  return stream.compressedSize >= minimumRawDeflateInput && stream.output.length >= stream.compressedSize;
}

function describe(stream: DecodedStream, outputPath: string | undefined): DetectedStream {
  return {
    method: stream.method,
    offset: stream.offset,
    compressedSize: stream.compressedSize,
    decompressedSize: stream.output.length,
    complete: stream.complete,
    evidence: stream.evidence,
    outputEntropy: roundTo(shannonEntropy(stream.output.subarray(0, entropySampleLength)), 3),
    outputPreview: toHex(stream.output.subarray(0, 32)),
    ...(outputPath ? { outputPath } : {}),
  };
}

function writeDecoded(workDir: string, file: string, stream: DecodedStream): string {
  const directory = resolve(workDir);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${basename(file)}.${stream.offset}.${stream.method}.bin`);
  writeFileSync(path, stream.output);
  return path;
}

function verdictFor(detected: DetectedStream[], entropy: number, length: number): { verdict: Verdict; note: string } {
  if (detected.length > 0) {
    return { verdict: "compressed", note: "A supported compression format decodes at this offset." };
  }
  if (entropy >= highEntropyThreshold(Math.min(length, entropySampleLength))) {
    return {
      verdict: "possibly-encrypted",
      note: "High entropy and no supported compression decodes here. hexsleuth reports this and stops; it does not attempt decryption, key search or XOR guessing.",
    };
  }
  return { verdict: "not-compressed", note: "No supported compression decodes here and the entropy is not high." };
}

export function detectCompression(input: z.infer<z.ZodObject<typeof detectCompressionInput>>): DetectCompressionOutput {
  const file = loadFile(input.file);
  const range = clampRange(file.bytes.length, input.offset, input.length);
  const considered = file.bytes.subarray(0, range.offset + range.length);
  const tried = methodsToTry(considered, range.offset, input.method);
  const entropy = roundTo(shannonEntropy(considered.subarray(range.offset, range.offset + entropySampleLength)), 3);
  const detected: DetectedStream[] = [];
  for (const method of tried) {
    const stream = tryDecode(considered, range.offset, method);
    if (!stream || (method === "deflate-raw" && input.method === "auto" && !plausibleRawDeflate(stream))) {
      continue;
    }
    const outputPath = input.writeOutput ? writeDecoded(input.workDir, input.file, stream) : undefined;
    detected.push(describe(stream, outputPath));
    break;
  }
  return {
    file: input.file,
    offset: range.offset,
    consideredLength: range.length,
    entropy,
    tried,
    ...verdictFor(detected, entropy, range.length),
    detected,
  };
}

export const detectCompressionTool = defineTool({
  name: "detect_compression",
  title: "Detect compression",
  description:
    "Test whether a standard compressed stream (zlib, gzip, raw deflate, LZ4 frame, Zstandard frame) starts at an offset, report its compressed and decompressed sizes, and write the decompressed bytes to a work directory. High entropy that does not decode is reported as possibly-encrypted; nothing is decrypted.",
  inputShape: detectCompressionInput,
  run: detectCompression,
});
