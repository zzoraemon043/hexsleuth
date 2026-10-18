import { z } from "zod";
import { loadFile } from "../core/files.js";
import { resolveLayout } from "../layout/load.js";
import { verifySample, type SampleVerification } from "../layout/verify.js";
import { defineTool } from "./definition.js";

export const verifyLayoutInput = {
  files: z.array(z.string()).min(1).describe("Sample files to parse"),
  layout: z.unknown().optional().describe("A layout in hexsleuth layout JSON"),
  layoutFile: z.string().optional().describe("Path to a layout JSON file, used when layout is not given"),
  includeTree: z.boolean().default(true).describe("Include the parsed tree for each sample"),
  maxArrayItems: z.number().int().min(0).default(32).describe("Maximum repeated items shown per array in the tree"),
  maxUnreadRanges: z.number().int().min(0).default(50).describe("Maximum unread ranges listed per sample"),
};

export interface VerifyLayoutOutput {
  layout: string;
  samples: SampleVerification[];
  summary: { samples: number; parsed: number; failed: number; fullyRead: number };
}

export function verifyLayout(input: z.infer<z.ZodObject<typeof verifyLayoutInput>>): VerifyLayoutOutput {
  const layout = resolveLayout(input);
  const samples = input.files.map((file) =>
    verifySample(layout, file, loadFile(file).bytes, {
      includeTree: input.includeTree,
      maxArrayItems: input.maxArrayItems,
      maxUnreadRanges: input.maxUnreadRanges,
    }),
  );
  return {
    layout: layout.id,
    samples,
    summary: {
      samples: samples.length,
      parsed: samples.filter((sample) => sample.ok).length,
      failed: samples.filter((sample) => !sample.ok).length,
      fullyRead: samples.filter((sample) => sample.ok && sample.unreadBytes === 0).length,
    },
  };
}

export const verifyLayoutTool = defineTool({
  name: "verify_layout",
  title: "Verify a layout",
  description:
    "Parse every sample with a candidate layout in hexsleuth layout JSON. For each sample, report the parsed tree, the first field that fails and the byte ranges that no field read.",
  inputShape: verifyLayoutInput,
  run: verifyLayout,
});
