import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { xxhash32 } from "../src/core/compression/xxhash32.js";
import { runTool } from "../src/tools/definition.js";
import { detectCompressionTool } from "../src/tools/detect-compression.js";
import { fixtureNamed } from "./helpers.js";

const workDir = mkdtempSync(join(tmpdir(), "hexsleuth-detect-"));

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function compressionFixture(name: string): { path: string; facts: Record<string, string | number> } {
  const file = fixtureNamed("compression", name);
  if (!file?.facts) {
    throw new Error(`missing fixture ${name}`);
  }
  return { path: file.path, facts: file.facts };
}

describe("detect_compression", () => {
  for (const name of ["zlib.bin", "gzip.bin", "lz4.bin", "zstd.bin", "zstd-raw-block.bin"]) {
    it(`detects the stream in ${name} with auto`, async () => {
      const { path, facts } = compressionFixture(name);
      const output = await runTool(detectCompressionTool, { file: path, offset: facts.offset, workDir });
      expect(output.verdict).toBe("compressed");
      expect(output.detected).toHaveLength(1);
      const [stream] = output.detected;
      expect(stream).toMatchObject({ method: facts.method, offset: facts.offset, compressedSize: facts.compressedSize, decompressedSize: facts.decompressedSize, complete: true });
      expect(stream?.outputPath).toBeDefined();
      const written = readFileSync(stream?.outputPath ?? "");
      expect(written.length).toBe(facts.decompressedSize);
      expect(written.toString("latin1")).toMatch(/^[a-z .\n]+$/);
    });
  }

  it("needs an explicit offset for raw deflate and finds it there", async () => {
    const { path, facts } = compressionFixture("deflate-raw.bin");
    const output = await runTool(detectCompressionTool, { file: path, offset: facts.offset, workDir, writeOutput: false });
    expect(output.tried).toEqual(["deflate-raw"]);
    expect(output.detected[0]).toMatchObject({ method: "deflate-raw", compressedSize: facts.compressedSize, decompressedSize: facts.decompressedSize });
    expect(output.detected[0]?.evidence).toContain("weaker evidence");
    expect(output.detected[0]?.outputPath).toBeUndefined();
  });

  it("tests only the requested method", async () => {
    const { path, facts } = compressionFixture("zlib.bin");
    const output = await runTool(detectCompressionTool, { file: path, offset: facts.offset, method: "zstd", writeOutput: false });
    expect(output.tried).toEqual(["zstd"]);
    expect(output.detected).toEqual([]);
  });

  it("reports random data as possibly-encrypted without decoding it", async () => {
    const { path } = compressionFixture("random.bin");
    for (const offset of [0, 1, 100, 1000]) {
      const output = await runTool(detectCompressionTool, { file: path, offset, writeOutput: false });
      expect(output.verdict).toBe("possibly-encrypted");
      expect(output.detected).toEqual([]);
      expect(output.note).toContain("does not attempt decryption");
    }
  });

  it("does not call short inputs possibly-encrypted", async () => {
    for (const text of ["HDR!", "abcdefghijklmnopqrstuvwxyz"]) {
      const path = join(workDir, `short-${text.length}.bin`);
      writeFileSync(path, text);
      const output = await runTool(detectCompressionTool, { file: path, writeOutput: false });
      expect(output.verdict).toBe("not-compressed");
    }
  });

  it("reports plain text as not compressed", async () => {
    const { path } = compressionFixture("plain.bin");
    const output = await runTool(detectCompressionTool, { file: path, writeOutput: false });
    expect(output.verdict).toBe("not-compressed");
    expect(output.entropy).toBeLessThan(5);
  });

  it("honors the length limit", async () => {
    const { path, facts } = compressionFixture("zlib.bin");
    const output = await runTool(detectCompressionTool, { file: path, offset: facts.offset, length: 100, writeOutput: false });
    expect(output.consideredLength).toBe(100);
    expect(output.detected[0]?.complete ?? false).toBe(false);
  });
});

describe("xxhash32", () => {
  it("matches the reference test vectors", () => {
    expect(xxhash32(new Uint8Array(0))).toBe(0x02cc5d05);
    expect(xxhash32(new TextEncoder().encode("abc"))).toBe(0x32d153ff);
    expect(xxhash32(new TextEncoder().encode("Nobody inspects the spammish repetition"))).toBe(0xe2293b2f);
  });
});
