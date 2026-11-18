import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync, gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { ByteWriter } from "../scripts/fixtures/byte-writer.js";
import { maxOutputLength } from "../src/core/compression/types.js";
import { xxhash32 } from "../src/core/compression/xxhash32.js";
import { runTool } from "../src/tools/definition.js";
import { detectCompressionTool } from "../src/tools/detect-compression.js";
import { fixtureNamed } from "./helpers.js";

const testTemp = resolve(".work");
mkdirSync(testTemp, { recursive: true });
const workDir = mkdtempSync(join(testTemp, "hexsleuth-detect-"));

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

  it.each([true, false])("verifies stored LZ4 block checksums after the payload (valid: %s)", async (valid) => {
    const payload = Buffer.from("stored block payload");
    const descriptor = Uint8Array.of(0x70, 0x40);
    const frame = new ByteWriter().u32le(0x184d2204).bytes(descriptor).u8((xxhash32(descriptor) >>> 8) & 0xff)
      .u32le((0x80000000 | payload.length) >>> 0).bytes(payload).u32le((xxhash32(payload) ^ (valid ? 0 : 1)) >>> 0)
      .u32le(0).toBytes();
    const file = join(workDir, `checksum-${valid}.lz4`);
    writeFileSync(file, frame);
    const output = await runTool(detectCompressionTool, { file, method: "lz4", workDir });
    if (!valid) {
      expect(output.detected).toEqual([]);
      return;
    }
    expect(output.detected[0]).toMatchObject({ method: "lz4", complete: true, compressedSize: frame.length });
    expect(readFileSync(output.detected[0]?.outputPath ?? "")).toEqual(payload);
  });

  it("keeps decoded output separate for samples with the same basename", async () => {
    const paths = ["run-a", "run-b"].map((name) => {
      const directory = join(workDir, name);
      mkdirSync(directory);
      const file = join(directory, "sample.gz");
      writeFileSync(file, gzipSync(name));
      return file;
    });
    const outputDir = join(workDir, ".hexsleuth-work");
    const first = (await runTool(detectCompressionTool, { file: paths[0], workDir: outputDir })).detected[0]?.outputPath;
    const second = (await runTool(detectCompressionTool, { file: paths[1], workDir: outputDir })).detected[0]?.outputPath;
    expect(first).not.toBe(second);
    expect(readFileSync(first ?? "", "utf8")).toBe("run-a");
    expect(readFileSync(second ?? "", "utf8")).toBe("run-b");
    expect((await runTool(detectCompressionTool, { file: paths[0], workDir: outputDir })).detected[0]?.outputPath).toBe(first);
  });

  it("reports the zlib output limit without writing a partial result", async () => {
    const file = join(workDir, "large.zlib");
    const outputDir = join(workDir, "large-output");
    writeFileSync(file, deflateSync(Buffer.alloc(maxOutputLength + 1024 * 1024, 0x61)));
    await expect(runTool(detectCompressionTool, { file, workDir: outputDir })).rejects.toThrow(/zlib decompressed output exceeds the 64 MiB limit/);
    expect(existsSync(outputDir)).toBe(false);
  });
});

describe("xxhash32", () => {
  it("matches the reference test vectors", () => {
    expect(xxhash32(new Uint8Array(0))).toBe(0x02cc5d05);
    expect(xxhash32(new TextEncoder().encode("abc"))).toBe(0x32d153ff);
    expect(xxhash32(new TextEncoder().encode("Nobody inspects the spammish repetition"))).toBe(0xe2293b2f);
  });
});
