import { z } from "zod";
import { clampRange, loadFile } from "../core/files.js";
import { toAsciiPreview, toHex } from "../core/hex.js";
import { readScalar, scalarTypes, type ScalarType, type ScalarValue } from "../core/scalar.js";
import { defineTool } from "./definition.js";

export const readBytesInput = {
  file: z.string().describe("Path to the file"),
  offset: z.number().int().min(0).default(0).describe("Start offset in bytes"),
  length: z.number().int().min(1).max(65536).default(256).describe("Number of bytes to show"),
  interpret: z
    .array(z.enum(scalarTypes))
    .default([])
    .describe("Scalar types to read at the start offset, for example u4le or f8be"),
};

export interface HexRow {
  offset: number;
  hex: string;
  ascii: string;
}

export interface Interpretation {
  type: ScalarType;
  offset: number;
  value: ScalarValue | null;
  error?: string;
}

export interface ReadBytesOutput {
  file: string;
  size: number;
  offset: number;
  length: number;
  rows: HexRow[];
  interpretations: Interpretation[];
}

const rowWidth = 16;

function interpretAt(bytes: Uint8Array, offset: number, type: ScalarType): Interpretation {
  try {
    return { type, offset, value: readScalar(bytes, offset, type) };
  } catch (error) {
    return { type, offset, value: null, error: (error as Error).message };
  }
}

export function readBytes(input: z.infer<z.ZodObject<typeof readBytesInput>>): ReadBytesOutput {
  const file = loadFile(input.file);
  const range = clampRange(file.bytes.length, input.offset, input.length);
  const rows: HexRow[] = [];
  for (let start = range.offset; start < range.offset + range.length; start += rowWidth) {
    const row = file.bytes.subarray(start, Math.min(start + rowWidth, range.offset + range.length));
    rows.push({ offset: start, hex: toHex(row), ascii: toAsciiPreview(row) });
  }
  return {
    file: input.file,
    size: file.bytes.length,
    offset: range.offset,
    length: range.length,
    rows,
    interpretations: input.interpret.map((type) => interpretAt(file.bytes, range.offset, type)),
  };
}

export const readBytesTool = defineTool({
  name: "read_bytes",
  title: "Read bytes",
  description: "Show a hex and ASCII view of a byte range, optionally interpreting the start offset as integers or floats.",
  inputShape: readBytesInput,
  run: readBytes,
});
