import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseExpression } from "../src/layout/expression.js";
import { LayoutError, parseLayout } from "../src/layout/load.js";
import { runTool } from "../src/tools/definition.js";
import { verifyLayoutTool } from "../src/tools/verify-layout.js";
import type { TreeNode } from "../src/layout/values.js";
import { exampleFormats, exampleLayout, exampleLayoutPath } from "./helpers-layout.js";
import { fixturePaths } from "./helpers.js";

function findNode(node: TreeNode | undefined, name: string): TreeNode | undefined {
  if (!node) {
    return undefined;
  }
  if (node.name === name) {
    return node;
  }
  for (const child of [...(node.fields ?? []), ...(node.items ?? [])]) {
    const found = findNode(child, name);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe("layout expressions", () => {
  it("parses arithmetic, comparisons, members, indexes and strings", () => {
    expect(parseExpression("_root.header.pool_offset + name_offset * 2")).toMatchObject({ kind: "binary", operator: "+" });
    expect(parseExpression('chunk_id == "fmt " and not (length % 2 == 1)')).toMatchObject({ kind: "binary", operator: "and" });
    expect(parseExpression("entries[0].data_offset")).toMatchObject({ kind: "member", property: "data_offset" });
    expect(parseExpression("0x10 - -4")).toMatchObject({ kind: "binary", operator: "-", right: { kind: "unary" } });
    expect(() => parseExpression("a +")).toThrow(/unexpected/);
    expect(parseExpression('mode == "-"')).toMatchObject({ kind: "binary", right: { kind: "string", value: "-" } });
    expect(parseExpression('"not" == mode')).toMatchObject({ kind: "binary", left: { kind: "string", value: "not" } });
    expect(() => parseExpression("a $ b")).toThrow(/unexpected character/);
  });
});

describe("layout validation", () => {
  it("accepts the example layouts", () => {
    for (const format of exampleFormats) {
      expect(() => parseLayout(exampleLayout(format))).not.toThrow();
    }
  });

  it("reports every problem it finds", () => {
    const broken = {
      id: "broken",
      endian: "le",
      seq: [
        { id: "a", type: "missing_type" },
        { id: "b", type: "bytes" },
        { id: "c", type: "str", size: 4 },
        { id: "c", type: "u4", repeat: "expr" },
        { id: "d", type: "u2", size: "1 +" },
      ],
    };
    try {
      parseLayout(broken);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LayoutError);
      const problems = (error as LayoutError).problems;
      expect(problems).toContain("broken.a: unknown type missing_type");
      expect(problems).toContain("broken.b: bytes needs size or sizeEos");
      expect(problems).toContain("broken.c: strings need an encoding");
      expect(problems).toContain("broken.c: duplicate id");
      expect(problems).toContain("broken.c: repeat expr needs repeatExpr");
      expect(problems.some((problem) => problem.startsWith("broken.d.size:"))).toBe(true);
    }
  });

  it("rejects unknown keys and bad identifiers", () => {
    expect(() => parseLayout({ id: "Bad-Id", endian: "le", seq: [] })).toThrow(LayoutError);
    expect(() => parseLayout({ id: "ok", endian: "le", seq: [{ id: "x", type: "u1", sise: 3 }] })).toThrow(/sise|Unrecognized/);
  });
});

describe("verify_layout", () => {
  for (const format of exampleFormats) {
    it(`parses every ${format} sample and reads every byte`, async () => {
      const output = await runTool(verifyLayoutTool, { files: fixturePaths(format), layoutFile: exampleLayoutPath(format), includeTree: false });
      expect(output.summary).toEqual({ samples: 6, parsed: 6, failed: 0, fullyRead: 6 });
      for (const sample of output.samples) {
        expect(sample.error).toBeNull();
        expect(sample.unread).toEqual([]);
        expect(sample.readBytes).toBe(sample.size);
      }
    });
  }

  it("returns a parsed tree with offsets and values", async () => {
    const output = await runTool(verifyLayoutTool, { files: fixturePaths("hxsf").slice(1, 2), layout: exampleLayout("hxsf") });
    const tree = output.samples[0]?.tree;
    expect(findNode(tree, "entry_count")).toMatchObject({ type: "u4", offset: 12, size: 4, value: 3 });
    expect(findNode(tree, "entries")?.items).toHaveLength(3);
    const name = findNode(findNode(tree, "entries[0]"), "name");
    expect(name?.value).toMatch(/\.(txt|bin)$/);
    const inflated = findNode(tree, "inflated_data");
    expect(inflated?.type).toMatch(/^bytes \(zlib, \d+ bytes inflated\)$/);
  });

  it("names the first failing field and its offset", async () => {
    const layout = exampleLayout("png");
    const chunk = layout.types?.chunk;
    if (!chunk) {
      throw new Error("missing chunk type");
    }
    chunk.seq = chunk.seq.filter((field) => field.id !== "crc");
    const output = await runTool(verifyLayoutTool, { files: fixturePaths("png").slice(0, 1), layout, includeTree: false });
    const [sample] = output.samples;
    expect(sample?.ok).toBe(false);
    expect(sample?.error?.path).toMatch(/^png\.chunks\[\d+\]\.data$/);
    expect(sample?.error?.message).toMatch(/needs \d+ bytes but only \d+ remain/);
    expect(sample?.error?.offset).toBeGreaterThan(8);
  });

  it("reports a contents mismatch with expected and found bytes", async () => {
    const output = await runTool(verifyLayoutTool, { files: fixturePaths("wav").slice(0, 1), layout: exampleLayout("png"), includeTree: false });
    expect(output.samples[0]?.error).toEqual({
      path: "png.signature",
      offset: 0,
      message: "contents mismatch: expected 89 50 4e 47 0d 0a 1a 0a, found 52 49 46 46 a4 00 00 00",
    });
  });

  it("lists unread bytes when the layout stops early", async () => {
    const layout = exampleLayout("hxsf");
    const entry = layout.types?.entry;
    if (!entry) {
      throw new Error("missing entry type");
    }
    delete entry.instances;
    const output = await runTool(verifyLayoutTool, { files: fixturePaths("hxsf"), layout, includeTree: false });
    expect(output.summary.parsed).toBe(6);
    expect(output.summary.fullyRead).toBe(0);
    for (const sample of output.samples) {
      expect(sample.unread).toHaveLength(1);
      const [gap] = sample.unread;
      expect((gap?.offset ?? 0) + (gap?.length ?? 0)).toBe(sample.size);
    }
  });

  it("truncates long arrays in the tree", async () => {
    const output = await runTool(verifyLayoutTool, { files: fixturePaths("hxsf").slice(5, 6), layout: exampleLayout("hxsf"), maxArrayItems: 2 });
    const entries = findNode(output.samples[0]?.tree, "entries");
    expect(entries?.items).toHaveLength(2);
    expect(entries?.itemsTruncated).toBe(4);
  });

  it("stops a repeat eos item that consumes no bytes", async () => {
    const layout = {
      id: "z",
      endian: "le",
      seq: [{ id: "e", type: "empty", repeat: "eos" }],
      types: { empty: { seq: [{ id: "x", type: "u1", if: "false" }] } },
    };
    const output = await runTool(verifyLayoutTool, { files: fixturePaths("png").slice(0, 1), layout, includeTree: false });
    expect(output.samples[0]?.error).toEqual({ path: "z.e[0]", offset: 0, message: "repeat item consumed 0 bytes" });
  });

  it("skips the right side of and/or when the left side decides", async () => {
    const layout = {
      id: "s",
      endian: "le",
      seq: [
        { id: "n", type: "u1" },
        { id: "a", type: "u1", if: "n != 0 and 10 / n > 3" },
        { id: "b", type: "u1", if: "n == 0 or 10 / n > 3" },
      ],
    };
    const dir = mkdtempSync(join(tmpdir(), "hexsleuth-"));
    try {
      const file = join(dir, "zero.bin");
      writeFileSync(file, Buffer.from([0, 7]));
      const output = await runTool(verifyLayoutTool, { files: [file], layout, includeTree: false });
      expect(output.samples[0]?.error).toBeNull();
      expect(output.samples[0]?.readBytes).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compares 64-bit values above 2^53 exactly", async () => {
    const conditions = ["id > 0", "id >= 0xffffffffffffff00", "id == 0xffffffffffffff00", "id != 18446744073709551615", "id > -9223372036854775808", "id > 9007199254740993"];
    const layout = {
      id: "w",
      endian: "le",
      seq: [{ id: "id", type: "u8" }, ...conditions.map((condition, index) => ({ id: `c${index}`, type: "u1", if: condition }))],
    };
    const dir = mkdtempSync(join(tmpdir(), "hexsleuth-"));
    try {
      const file = join(dir, "wide.bin");
      writeFileSync(file, Buffer.from([0, 255, 255, 255, 255, 255, 255, 255, 1, 2, 3, 4, 5, 6]));
      const output = await runTool(verifyLayoutTool, { files: [file], layout, includeTree: false });
      expect(output.samples[0]?.error).toBeNull();
      expect(output.samples[0]?.readBytes).toBe(14);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires a layout", async () => {
    await expect(runTool(verifyLayoutTool, { files: fixturePaths("png") })).rejects.toThrow(/layout or layoutFile/);
  });
});
