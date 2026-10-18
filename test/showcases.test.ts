import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runTool } from "../src/tools/definition.js";
import { verifyLayoutTool, type VerifyLayoutOutput } from "../src/tools/verify-layout.js";
import { fixturePaths } from "./helpers.js";

async function verifyDraft(format: string): Promise<VerifyLayoutOutput> {
  return runTool(verifyLayoutTool, {
    files: fixturePaths(format),
    layoutFile: resolve("docs/showcases/layouts", `${format}-draft.json`),
    includeTree: false,
  });
}

describe("showcase draft layouts behave as the showcases describe", () => {
  it("png draft fails at the second chunk because the CRC is missing", async () => {
    const output = await verifyDraft("png");
    expect(output.summary).toEqual({ samples: 6, parsed: 0, failed: 6, fullyRead: 0 });
    expect(output.samples[0]?.error).toEqual({ path: "png.chunks[1].data", offset: 37, message: "needs 981375829 bytes but only 30 remain" });
  });

  it("wav draft fails only on the sample with an odd-sized chunk", async () => {
    const output = await verifyDraft("wav");
    expect(output.summary).toEqual({ samples: 6, parsed: 5, failed: 1, fullyRead: 5 });
    expect(output.samples[2]?.error).toEqual({ path: "wav.chunks[2].body", offset: 55, message: "needs 131681 bytes but only 515 remain" });
  });

  it("zip draft stops at the central directory", async () => {
    const output = await verifyDraft("zip");
    expect(output.summary.failed).toBe(6);
    for (const sample of output.samples) {
      expect(sample.error?.message).toBe("contents mismatch: expected 50 4b 03 04, found 50 4b 01 02");
    }
    expect(output.samples[0]?.error?.offset).toBe(89);
  });

  it("hxsf draft leaves exactly the data area unread", async () => {
    const output = await verifyDraft("hxsf");
    expect(output.summary).toEqual({ samples: 6, parsed: 6, failed: 0, fullyRead: 0 });
    for (const sample of output.samples) {
      const bytes = readFileSync(sample.file);
      const dataOffset = bytes.readUInt32LE(28);
      expect(sample.unread).toEqual([{ offset: dataOffset, length: sample.size - dataOffset }]);
    }
  });
});
