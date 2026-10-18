import { z } from "zod";
import { emitArtifacts, type EmittedFiles } from "../emit/index.js";
import { loadFile } from "../core/files.js";
import { resolveLayout } from "../layout/load.js";
import { defineTool } from "./definition.js";

export const emitInput = {
  files: z.array(z.string()).min(1).describe("Sample files the layout must parse; the emitted tests parse each of them"),
  layout: z.unknown().optional().describe("A verified layout in hexsleuth layout JSON"),
  layoutFile: z.string().optional().describe("Path to a layout JSON file, used when layout is not given"),
  outDir: z.string().describe("Directory for the emitted files"),
  evidence: z
    .array(z.object({ claim: z.string(), check: z.string(), confidence: z.number() }).passthrough())
    .default([])
    .describe("Findings to cite in the specification, for example from infer_fields"),
  allowFailures: z.boolean().default(false).describe("Emit even if some samples fail to parse; those samples are left out of the tests"),
};

export interface EmitOutput {
  layout: string;
  outDir: string;
  files: EmittedFiles;
  verification: { samples: number; parsed: number; fullyRead: number };
  notes: string[];
}

export function emit(input: z.infer<z.ZodObject<typeof emitInput>>): EmitOutput {
  const layout = resolveLayout(input);
  const samples = input.files.map((file) => ({ file, bytes: loadFile(file).bytes }));
  const evidence = input.evidence.map((item) => ({ claim: item.claim, check: item.check, confidence: item.confidence }));
  const result = emitArtifacts(layout, samples, input.outDir, evidence, input.allowFailures);
  const parsed = result.samples.filter((sample) => sample.ok).length;
  return {
    layout: layout.id,
    outDir: input.outDir,
    files: result.files,
    verification: {
      samples: result.samples.length,
      parsed,
      fullyRead: result.samples.filter((sample) => sample.ok && sample.unreadBytes === 0).length,
    },
    notes: [
      "The TypeScript parser depends only on node:zlib. The test imports vitest and reads the samples by path relative to the output directory.",
      "The .ksy file uses only constructs that the layout JSON supports, so it compiles with the Kaitai Struct compiler.",
    ],
  };
}

export const emitTool = defineTool({
  name: "emit",
  title: "Emit artifacts",
  description:
    "Verify a layout against every sample, then write a Markdown specification, a Kaitai Struct .ksy file, a TypeScript parser and Vitest tests that parse every sample.",
  inputShape: emitInput,
  run: emit,
});
