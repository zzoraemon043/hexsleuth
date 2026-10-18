import { describe, expect, it } from "vitest";
import { runTool } from "../src/tools/definition.js";
import { inferFieldsTool, type InferFieldsOutput } from "../src/tools/infer-fields.js";
import type { Finding } from "../src/infer/finding.js";
import { fixtureManifest, fixturePaths } from "./helpers.js";

async function infer(format: string, extra: Record<string, unknown> = {}): Promise<InferFieldsOutput> {
  return runTool(inferFieldsTool, { files: fixturePaths(format), ...extra });
}

function findingAt(output: InferFieldsOutput, kind: string, label: string, type: string): Finding | undefined {
  return output.findings.find((finding) => finding.kind === kind && finding.field?.label === label && finding.field.type === type);
}

function expectWellFormed(finding: Finding, sampleCount: number): void {
  expect(finding.confidence).toBeGreaterThan(0);
  expect(finding.confidence).toBeLessThanOrEqual(1);
  expect(finding.check.length).toBeGreaterThan(0);
  expect(finding.supportingSamples).toHaveLength(sampleCount);
  expect(finding.evidence.length).toBeGreaterThan(0);
  for (const evidence of finding.evidence) {
    expect(evidence.range.offset).toBeGreaterThanOrEqual(0);
    expect(evidence.range.length).toBeGreaterThan(0);
  }
}

describe("infer_fields on PNG", () => {
  it("finds the big-endian chunk chain after the signature", async () => {
    const output = await infer("png");
    const chain = findingAt(output, "record-chain", "0x0008", "u4be");
    expect(chain?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(chain?.claim).toContain("value + 12 bytes");
    expect(chain?.claim).toContain("printable 4-byte tag at +4");
    expect(chain?.evidence[0]?.detail).toMatch(/^3 records ending exactly at 67: IHDR\(13\), IDAT\(\d+\), IEND\(0\)$/);
    const endianness = output.findings.find((finding) => finding.kind === "endianness");
    expect(endianness?.claim).toBe("multi-byte integers are big-endian");
    for (const finding of output.findings) {
      expectWellFormed(finding, 6);
    }
  });
});

describe("infer_fields on WAV", () => {
  it("finds the RIFF size and the padded chunk chain", async () => {
    const output = await infer("wav");
    const length = findingAt(output, "length", "0x0004", "u4le");
    expect(length?.check).toBe("value equals file size minus 8 in 6 of 6 samples (6 distinct sizes)");
    expect(length?.evidence.map((evidence) => evidence.value)).toEqual(fixtureManifest().wav?.map((file) => file.size - 8));
    const chain = findingAt(output, "record-chain", "0x0010", "u4le");
    expect(chain?.claim).toContain("padded to an even length");
    expect(chain?.claim).toContain("from 0x000c");
    expect(output.findings.find((finding) => finding.kind === "endianness")?.claim).toContain("little-endian");
  });
});

describe("infer_fields on ZIP", () => {
  it("finds the central directory offset, size and entry counts anchored at the end", async () => {
    const output = await infer("zip");
    const offset = findingAt(output, "offset", "end-6", "u4le");
    expect(offset?.check).toContain("points to the same bytes 50 4b 01 02 in 6 of 6 samples");
    expect(offset?.confidence).toBeGreaterThanOrEqual(0.9);
    const size = findingAt(output, "length", "end-10", "u4le");
    expect(size?.check).toBe("u4le at end-6 + value equals file size minus 22 in 6 of 6 samples");
    const count = findingAt(output, "count", "end-12", "u2le");
    expect(count?.check).toContain("number of occurrences of 50 4b 03 04");
    const version = findingAt(output, "version", "0x0004", "u2le");
    expect(version?.evidence.every((evidence) => evidence.value === 20)).toBe(true);
    expect(version?.limits.some((limit) => limit.includes("same in every sample"))).toBe(true);
  });

  it("can turn off the end-anchored scan", async () => {
    const output = await infer("zip", { endScanLength: 0 });
    expect(output.findings.every((finding) => finding.field?.anchor !== "end")).toBe(true);
  });
});

describe("infer_fields on HXSF", () => {
  it("recovers the header fields of the custom format", async () => {
    const output = await infer("hxsf");
    expect(findingAt(output, "magic", "0x0000", "bytes[4]")?.claim).toContain('"HXSF"');
    expect(findingAt(output, "length", "0x0008", "u4le")?.claim).toContain("total file size");
    const count = findingAt(output, "count", "0x000c", "u4le");
    expect(count?.check).toBe("u4le at 0x0014 equals 32 + 20 x value in 6 of 6 samples (6 distinct counts)");
    expect(count?.evidence.map((evidence) => evidence.value)).toEqual([1, 3, 2, 5, 4, 6]);
    expect(findingAt(output, "offset", "0x0010", "u4le")?.check).toContain("table of u4le at 0x000c x 20-byte records starts");
    expect(findingAt(output, "offset", "0x0014", "u4le")?.confidence).toBeGreaterThanOrEqual(0.9);
    expect(findingAt(output, "length", "0x0018", "u4le")?.check).toBe("u4le at 0x0014 + value equals u4le at 0x001c in 6 of 6 samples");
    expect(findingAt(output, "offset", "0x001c", "u4le")).toBeDefined();
    const version = findingAt(output, "version", "0x0004", "u2le");
    expect(version?.evidence.map((evidence) => evidence.value)).toEqual([1, 2, 1, 2, 1, 2]);
    for (const finding of output.findings) {
      expectWellFormed(finding, 6);
    }
  });

  it("lowers confidence and states the limit when only two samples are given", async () => {
    const full = await infer("hxsf");
    const pair = await runTool(inferFieldsTool, { files: fixturePaths("hxsf").slice(0, 2) });
    const fullLength = findingAt(full, "length", "0x0008", "u4le");
    const pairLength = findingAt(pair, "length", "0x0008", "u4le");
    expect(pairLength?.confidence).toBeLessThan(fullLength?.confidence ?? 0);
    expect(pairLength?.limits).toContain("only 2 samples; add more samples to raise confidence");
  });

  it("restricts the scan to a region", async () => {
    const output = await infer("hxsf", { region: { offset: 8, length: 8 }, endScanLength: 0 });
    const located = output.findings.filter((finding) => finding.field && finding.kind !== "magic");
    expect(located.every((finding) => (finding.field?.position ?? 0) >= 8 && (finding.field?.position ?? 0) < 16)).toBe(true);
    expect(findingAt(output, "length", "0x0008", "u4le")).toBeDefined();
  });

  it("sorts findings by confidence and respects the limits", async () => {
    const output = await infer("hxsf", { maxFindings: 3, minConfidence: 0.5 });
    expect(output.findings).toHaveLength(3);
    const confidences = output.findings.map((finding) => finding.confidence);
    expect([...confidences].sort((left, right) => right - left)).toEqual(confidences);
  });
});
