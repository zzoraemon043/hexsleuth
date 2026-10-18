import { describe, expect, it } from "vitest";
import { runTool } from "../src/tools/definition.js";
import { probeTool } from "../src/tools/probe.js";
import { fixturePaths } from "./helpers.js";

describe("probe", () => {
  it("recognizes the magic numbers of open formats", async () => {
    const expectations: Record<string, string> = { png: "PNG image", zip: "ZIP local file header", wav: "WAVE audio in RIFF" };
    for (const [format, name] of Object.entries(expectations)) {
      for (const file of fixturePaths(format)) {
        const output = await runTool(probeTool, { file });
        expect(output.magic.map((candidate) => candidate.name), file).toContain(name);
      }
    }
  });

  it("reports an unknown printable tag for the custom format", async () => {
    const output = await runTool(probeTool, { file: fixturePaths("hxsf")[0] });
    expect(output.magic).toEqual([{ offset: 0, bytes: "48 58 53 46", name: 'unknown printable tag "HXSF"', confidence: 0.5 }]);
  });

  it("maps entropy per block and finds printable strings with offsets", async () => {
    const file = fixturePaths("wav")[1];
    const output = await runTool(probeTool, { file, blockSize: 64 });
    expect(output.entropy.blocks[0]).toMatchObject({ offset: 0, length: 64 });
    expect(output.entropy.blocks.every((block) => block.entropy >= 0 && block.entropy <= 8)).toBe(true);
    expect(output.strings).toContainEqual({ offset: 8, length: 8, text: "WAVEfmt " });
    expect(output.strings).toContainEqual({ offset: 56, length: 4, text: "tone" });
    expect(output.entropy.highEntropyRegions).toEqual([]);
  });

  it("classifies zlib data as compressed and random data as possibly-encrypted", async () => {
    const outputs = await Promise.all(fixturePaths("hxsf").map((file) => runTool(probeTool, { file })));
    const regions = outputs.flatMap((output) => output.entropy.highEntropyRegions);
    const compressed = regions.filter((region) => region.classification === "compressed");
    const encrypted = regions.filter((region) => region.classification === "possibly-encrypted");
    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.every((region) => region.compression?.method === "zlib" && region.compression.complete)).toBe(true);
    expect(encrypted.length).toBeGreaterThan(0);
    expect(encrypted.every((region) => region.note.includes("does not attempt decryption"))).toBe(true);
  });

  it("marks a zlib stream split across PNG chunks as interrupted", async () => {
    const output = await runTool(probeTool, { file: fixturePaths("png")[2] });
    const [first, second] = output.entropy.highEntropyRegions;
    expect(first?.compression).toMatchObject({ method: "zlib", offset: 41, complete: false });
    expect(second?.classification).toBe("possibly-encrypted");
    expect(second?.note).toMatch(/continuation of that stream/);
  });

  it("probes a byte range with absolute offsets", async () => {
    const output = await runTool(probeTool, { file: fixturePaths("zip")[2], offset: 30, length: 15, minStringLength: 4 });
    expect(output.range).toEqual({ offset: 30, length: 15 });
    expect(output.strings[0]?.offset).toBe(30);
    expect(output.strings[0]?.text.startsWith("dir2/file-0.txt")).toBe(true);
  });

  it("reports repeated patterns, padding runs and size alignment", async () => {
    const png = await runTool(probeTool, { file: fixturePaths("png")[4] });
    const idat = png.repeatedPatterns.find((pattern) => pattern.ascii === "IDAT");
    expect(idat?.count).toBe(3);
    const wav = await runTool(probeTool, { file: fixturePaths("wav")[5] });
    expect(wav.alignment.sizeAlignment).toBe(4);
    expect(wav.alignment.paddingRuns.some((run) => run.byte === 0 && run.length >= 6)).toBe(true);
  });
});
