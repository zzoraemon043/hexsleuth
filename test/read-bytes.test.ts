import { describe, expect, it } from "vitest";
import { runTool } from "../src/tools/definition.js";
import { readBytesTool } from "../src/tools/read-bytes.js";
import { fixturePaths } from "./helpers.js";

describe("read_bytes", () => {
  it("shows hex and ASCII rows for a range", async () => {
    const [png] = fixturePaths("png");
    const output = await runTool(readBytesTool, { file: png, offset: 0, length: 20 });
    expect(output.offset).toBe(0);
    expect(output.length).toBe(20);
    expect(output.rows).toHaveLength(2);
    expect(output.rows[0]).toEqual({ offset: 0, hex: "89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52", ascii: ".PNG........IHDR" });
    expect(output.rows[1]?.offset).toBe(16);
  });

  it("interprets scalars at the start offset in both byte orders", async () => {
    const [png] = fixturePaths("png");
    const output = await runTool(readBytesTool, { file: png, offset: 8, length: 4, interpret: ["u4be", "u4le", "u2be", "u1", "f4be"] });
    expect(output.interpretations.map((item) => item.value)).toEqual([13, 0x0d000000, 0, 0, 1.8216880036222622e-44]);
  });

  it("reports interpretations that run past the end instead of failing", async () => {
    const [wav] = fixturePaths("wav");
    const sizeOutput = await runTool(readBytesTool, { file: wav, offset: 0, length: 1 });
    const output = await runTool(readBytesTool, { file: wav, offset: sizeOutput.size - 2, length: 16, interpret: ["u8le"] });
    expect(output.length).toBe(2);
    expect(output.interpretations[0]?.value).toBeNull();
    expect(output.interpretations[0]?.error).toMatch(/needs 8 bytes/);
  });

  it("rejects offsets outside the file", async () => {
    const [wav] = fixturePaths("wav");
    await expect(runTool(readBytesTool, { file: wav, offset: 10_000_000 })).rejects.toThrow(/outside the file/);
  });
});
