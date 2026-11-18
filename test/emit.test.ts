import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emitVitestTest, expectationsFor } from "../src/emit/vitest-test.js";
import { parseLayout } from "../src/layout/load.js";
import { verifySample } from "../src/layout/verify.js";
import { runTool } from "../src/tools/definition.js";
import { emitTool, type EmitOutput } from "../src/tools/emit.js";
import { inferFieldsTool } from "../src/tools/infer-fields.js";
import { exampleFormats, exampleLayout, exampleLayoutPath } from "./helpers-layout.js";
import { fixturePaths, readFixture } from "./helpers.js";

const emitRoot = resolve(".work/emit-test");
const outputs = new Map<string, EmitOutput>();
const requireFromRepository = createRequire(import.meta.url);

beforeAll(async () => {
  rmSync(emitRoot, { recursive: true, force: true });
  mkdirSync(emitRoot, { recursive: true });
  for (const format of exampleFormats) {
    const files = fixturePaths(format);
    const inferred = await runTool(inferFieldsTool, { files });
    outputs.set(format, await runTool(emitTool, { files, layoutFile: exampleLayoutPath(format), outDir: join(emitRoot, format), evidence: inferred.findings.slice(0, 6) }));
  }
});

afterAll(() => {
  rmSync(emitRoot, { recursive: true, force: true });
});

function emitted(format: string): EmitOutput {
  const output = outputs.get(format);
  if (!output) {
    throw new Error(`nothing emitted for ${format}`);
  }
  return output;
}

function expectedValues(format: string): { file: string; expectations: ReturnType<typeof expectationsFor> }[] {
  const layout = parseLayout(exampleLayout(format));
  return fixturePaths(format).map((file) => {
    const verification = verifySample(layout, file, readFixture(file), { includeTree: true, maxArrayItems: 1000, maxUnreadRanges: 10 });
    return { file, expectations: verification.tree ? expectationsFor(verification.tree) : [] };
  });
}

function typeErrors(files: string[]): string[] {
  const program = ts.createProgram(files, {
    strict: true,
    noUncheckedIndexedAccess: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ["node"],
    noEmit: true,
    skipLibCheck: true,
  });
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

async function compileKaitai(file: string): Promise<(bytes: Uint8Array) => unknown> {
  const compiler = requireFromRepository("kaitai-struct-compiler") as { compile(language: string, ksy: unknown, importer: null, debug: boolean): Promise<Record<string, string>> };
  const KaitaiStream = requireFromRepository("kaitai-struct/KaitaiStream") as new (buffer: ArrayBuffer) => unknown;
  const ksy: unknown = parseYaml(readFileSync(file, "utf8"));
  const compiled = await compiler.compile("javascript", ksy, null, false);
  const [source] = Object.values(compiled);
  const moduleExports: Record<string, new (stream: unknown) => unknown> = {};
  new Function("exports", "require", source ?? "")(moduleExports, requireFromRepository);
  const [Parser] = Object.values(moduleExports);
  if (!Parser) {
    throw new Error(`no parser compiled from ${file}`);
  }
  return (bytes) => new Parser(new KaitaiStream(Uint8Array.from(bytes).buffer));
}

function evaluateAccessor(parsed: unknown, accessor: string): unknown {
  return new Function("parsed", `return ${accessor};`)(parsed);
}

function camelCaseAccessor(accessor: string): string {
  return accessor.replace(/\.([a-z][a-z0-9_]*)/g, (_match, name: string) => `.${name.replace(/_([a-z0-9])/g, (_inner, letter: string) => letter.toUpperCase())}`);
}

describe("emit", () => {
  it("writes the four artifacts after verifying every sample", () => {
    for (const format of exampleFormats) {
      const output = emitted(format);
      expect(output.verification).toEqual({ samples: 6, parsed: 6, fullyRead: 6 });
      expect(Object.values(output.files).map((path) => basename(path)).sort()).toEqual([`${format}.ksy`, `${format}.md`, `${format}.test.ts`, `${format}.ts`]);
    }
  });

  it("refuses to emit a layout that fails on a sample", async () => {
    const layout = exampleLayout("png");
    await expect(runTool(emitTool, { files: fixturePaths("wav").slice(0, 1), layout, outDir: join(emitRoot, "refused") })).rejects.toThrow(/does not parse 1 of 1 samples/);
  });

  it("writes a specification with structure, verification, evidence and high-entropy regions", () => {
    const spec = readFileSync(emitted("hxsf").files.spec, "utf8");
    expect(spec).toContain("# HXSF sample container");
    expect(spec).toContain("| 0x000c | `entry_count` | `u4le` | 4 |  |");
    expect(spec).toContain("The layout parsed 6 of 6 samples; 6 of them were read completely.");
    expect(spec).toContain("## Evidence");
    expect(spec).toMatch(/\| possibly-encrypted \| `entries\[\d\]\.stored_data` \|/);
    expect(spec).toContain("does not attempt decryption");
  });

  it("emits TypeScript that type-checks in strict mode", () => {
    const files = exampleFormats.flatMap((format) => [emitted(format).files.parser, emitted(format).files.test]);
    expect(typeErrors(files)).toEqual([]);
  });

  it("emits parsers that reproduce the values verify_layout reads", async () => {
    for (const format of exampleFormats) {
      const parserModule = (await import(pathToFileURL(emitted(format).files.parser).href)) as Record<string, (bytes: Uint8Array) => unknown>;
      const parse = parserModule[`parse${format.charAt(0).toUpperCase()}${format.slice(1)}`];
      expect(parse, format).toBeTypeOf("function");
      for (const { file, expectations } of expectedValues(format)) {
        const parsed = parse?.(readFixture(file));
        expect(expectations.length, file).toBeGreaterThan(0);
        for (const expectation of expectations) {
          const actual = evaluateAccessor(parsed, expectation.accessor);
          const measured = expectation.matcher === "toHaveLength" ? (actual as unknown[]).length : actual;
          expect(measured, `${file} ${expectation.accessor}`).toBe(expectation.value);
        }
      }
    }
  });

  it("keeps the sign of -0 in emitted expectations", () => {
    const tree = { name: "f", type: "f", offset: 0, size: 8, fields: [{ name: "x", type: "f8", offset: 0, size: 8, value: -0 }] };
    const sample = { file: "out/a.bin", size: 8, ok: true, error: null, readBytes: 8, unreadBytes: 0, unread: [], tree };
    const source = emitVitestTest({ id: "f", endian: "le", seq: [] }, "./f.js", "out", [sample]);
    expect(source).toContain("expect(parsed.x).toBe(-0);");
  });

  it("keeps 64-bit integers above 2^53 exact", async () => {
    const outDir = join(emitRoot, "wide");
    mkdirSync(join(outDir, "odd names"), { recursive: true });
    const files = [0xf0, 0xf1, 0xf2].map((low) => {
      const bytes = new Uint8Array(26);
      const view = new DataView(bytes.buffer);
      view.setBigUint64(0, 0xffffffffffffff00n | BigInt(low), true);
      view.setBigInt64(8, -(2n ** 62n) - BigInt(low), false);
      view.setBigUint64(16, 2n, true);
      const file = join(outDir, "odd names", `${["a#", "b%41", "c d"][low - 0xf0]}.bin`);
      writeFileSync(file, bytes);
      return file;
    });
    const layout = {
      id: "wide",
      endian: "le",
      seq: [
        { id: "id", type: "u8" },
        { id: "delta", type: "s8be" },
        { id: "len", type: "u8" },
        { id: "tail", type: "bytes", size: "len" },
      ],
    };
    const output = await runTool(emitTool, { files, layout, outDir });
    expect(output.verification).toEqual({ samples: 3, parsed: 3, fullyRead: 3 });
    expect(typeErrors([output.files.parser, output.files.test])).toEqual([]);
    const tree = verifySample(parseLayout(layout), files[1]!, readFileSync(files[1]!), { includeTree: true, maxArrayItems: 10, maxUnreadRanges: 10 }).tree;
    expect(tree?.fields?.map((field) => field.value).slice(0, 2)).toEqual(["18446744073709551601", "-4611686018427388145"]);
    const parserModule = (await import(pathToFileURL(output.files.parser).href)) as { parseWide(bytes: Uint8Array): { id: number | bigint; delta: number | bigint } };
    expect(parserModule.parseWide(readFileSync(files[2]!))).toMatchObject({ id: 0xfffffffffffffff2n, delta: -(2n ** 62n) - 0xf2n });
    expect(readFileSync(output.files.test, "utf8")).toContain("expect(parsed.id).toBe(18446744073709551600n);");
  });

  it("emits 64-bit literals above 2^53 as bigint so comparisons match the evaluator", async () => {
    const outDir = resolve(".work/emit-wide-compare");
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    try {
      const file = join(outDir, "s.bin");
      writeFileSync(file, Uint8Array.from([0, 255, 255, 255, 255, 255, 255, 255, 9]));
      const layout = {
        id: "cmp",
        endian: "le",
        seq: [
          { id: "id", type: "u8" },
          { id: "hit", type: "u1", if: "id == 0xffffffffffffff00 and id > 9007199254740993" },
        ],
      };
      const output = await runTool(emitTool, { files: [file], layout, outDir });
      expect(output.verification).toEqual({ samples: 1, parsed: 1, fullyRead: 1 });
      expect(typeErrors([output.files.parser, output.files.test])).toEqual([]);
      const parserModule = (await import(pathToFileURL(output.files.parser).href)) as { parseCmp(bytes: Uint8Array): { hit?: number } };
      expect(parserModule.parseCmp(readFileSync(file)).hit).toBe(9);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("throws in emitted parsers when size, repeat-expr or pos is not an integer like the evaluator", async () => {
    const outDir = resolve(".work/emit-fraction");
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    try {
      const file = join(outDir, "s.bin");
      writeFileSync(file, Uint8Array.from([0, 0, 0, 64, 1, 2, 3]));
      const layout = {
        id: "frac",
        endian: "le",
        seq: [
          { id: "scale", type: "f4" },
          { id: "body", type: "bytes", size: "scale" },
          { id: "tail", type: "u1" },
        ],
      };
      const output = await runTool(emitTool, { files: [file], layout, outDir });
      expect(output.verification).toEqual({ samples: 1, parsed: 1, fullyRead: 1 });
      const parserModule = (await import(pathToFileURL(output.files.parser).href)) as { parseFrac(bytes: Uint8Array): { tail: number } };
      expect(parserModule.parseFrac(readFileSync(file)).tail).toBe(3);
      expect(() => parserModule.parseFrac(Uint8Array.from([0, 0, 192, 63, 1, 2, 3, 4]))).toThrow(/expected an integer, got 1.5/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("throws in emitted parsers on division and modulo by zero like the evaluator", async () => {
    const outDir = resolve(".work/emit-zero");
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    try {
      const files = [[2, 3, 1, 2, 3, 4, 5, 6], [4, 3, 1, 2, 3, 4, 5, 6]].map((bytes, index) => {
        const file = join(outDir, `s${index}.bin`);
        writeFileSync(file, Uint8Array.from(bytes));
        return file;
      });
      const layout = {
        id: "zero",
        endian: "le",
        seq: [
          { id: "count", type: "u1" },
          { id: "per", type: "u1" },
          { id: "head", type: "bytes", size: "count / 2" },
          { id: "tail", type: "bytes", size: "count % per" },
        ],
      };
      const output = await runTool(emitTool, { files, layout, outDir });
      expect(output.verification.parsed).toBe(2);
      const parserModule = (await import(pathToFileURL(output.files.parser).href)) as { parseZero(bytes: Uint8Array): unknown };
      expect(() => parserModule.parseZero(Uint8Array.from([2, 0, 1, 2]))).toThrow(/modulo by zero/);
      const divide = { ...layout, seq: layout.seq.map((field) => (field.id === "head" ? { ...field, size: "count / per" } : field)) };
      const divideOutDir = join(outDir, "divide");
      const dividing = await runTool(emitTool, { files, layout: divide, outDir: divideOutDir });
      const dividingModule = (await import(pathToFileURL(dividing.files.parser).href)) as { parseZero(bytes: Uint8Array): unknown };
      expect(() => dividingModule.parseZero(Uint8Array.from([2, 0, 1, 2]))).toThrow(/division by zero/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("makes emitted and/or give booleans and emitted indexing throw outside the array like the evaluator", async () => {
    const outDir = resolve(".work/emit-bool-index");
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    try {
      const files = [[1, 1, 9, 9, 9], [1, 1, 8, 8, 8]].map((bytes, index) => {
        const file = join(outDir, `s${index}.bin`);
        writeFileSync(file, Uint8Array.from(bytes));
        return file;
      });
      const layout = {
        id: "boolidx",
        endian: "le",
        seq: [
          { id: "a", type: "u1" },
          { id: "b", type: "u1" },
          { id: "head", type: "bytes", size: "(a and b) * 1" },
          { id: "tail", type: "bytes", sizeEos: true },
        ],
      };
      const output = await runTool(emitTool, { files, layout, outDir });
      expect(output.verification.parsed).toBe(2);
      const parserModule = (await import(pathToFileURL(output.files.parser).href)) as { parseBoolidx(bytes: Uint8Array): { head: Uint8Array } };
      expect(parserModule.parseBoolidx(Uint8Array.from([3, 5, 9, 9, 9])).head.length).toBe(1);
      const indexDir = join(outDir, "index");
      const indexFiles = [[1, 2, 1, 9], [0, 1, 0, 9]].map((bytes, index) => {
        const file = join(outDir, `i${index}.bin`);
        writeFileSync(file, Uint8Array.from(bytes));
        return file;
      });
      const indexLayout = {
        id: "boolidx",
        endian: "le",
        seq: [
          { id: "count", type: "u1" },
          { id: "data", type: "bytes", size: 2 },
          { id: "tail", type: "bytes", size: "data[count]" },
        ],
      };
      const indexed = await runTool(emitTool, { files: indexFiles, layout: indexLayout, outDir: indexDir });
      expect(indexed.verification.parsed).toBe(2);
      const indexModule = (await import(pathToFileURL(indexed.files.parser).href)) as { parseBoolidx(bytes: Uint8Array): unknown };
      expect(() => indexModule.parseBoolidx(Uint8Array.from([5, 1, 2, 9]))).toThrow(/outside an array/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("emits Vitest tests that pass when run on their own", () => {
    const reportPath = join(emitRoot, "report.json");
    const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--root", emitRoot, "--reporter", "json", "--outputFile", reportPath], {
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { numTotalTests: number; numPassedTests: number; numFailedTests: number };
    expect(report.numFailedTests).toBe(0);
    expect(report.numTotalTests).toBe(exampleFormats.length * 6 + 3);
    expect(report.numPassedTests).toBe(report.numTotalTests);
  }, 60000);

  it("emits .ksy files that the Kaitai Struct compiler accepts and that parse every sample", async () => {
    for (const format of exampleFormats) {
      const parse = await compileKaitai(emitted(format).files.kaitai);
      for (const { file, expectations } of expectedValues(format)) {
        const parsed = parse(readFixture(file));
        for (const expectation of expectations) {
          const actual = evaluateAccessor(parsed, camelCaseAccessor(expectation.accessor));
          const measured = expectation.matcher === "toHaveLength" ? (actual as unknown[]).length : actual;
          expect(measured, `kaitai ${file} ${expectation.accessor}`).toBe(expectation.value);
        }
      }
    }
  });

  it.each(["same path", "hard link"])("refuses to overwrite a sample through a %s", async (alias) => {
    const outDir = join(emitRoot, alias);
    mkdirSync(outDir);
    const parser = join(outDir, "capture.ts");
    const file = alias === "hard link" ? join(outDir, "sample.bin") : parser;
    const bytes = Buffer.from([0x47, 0x1f, 0xff]);
    writeFileSync(file, bytes);
    if (file !== parser) {
      linkSync(file, parser);
    }
    const layout = { id: "capture", endian: "le", seq: [{ id: "data", type: "bytes", sizeEos: true }] };
    await expect(runTool(emitTool, { files: [file], layout, outDir })).rejects.toThrow(/aliases an input file/);
    expect(readFileSync(file)).toEqual(bytes);
    expect(readdirSync(outDir).sort()).toEqual(file === parser ? ["capture.ts"] : ["capture.ts", "sample.bin"]);
  });

  it("protects the layout input from artifact writes too", async () => {
    const outDir = join(emitRoot, "layout-alias");
    mkdirSync(outDir);
    const layoutFile = join(outDir, "capture.md");
    const layout = { id: "capture", endian: "le", seq: [{ id: "data", type: "bytes", sizeEos: true }] };
    writeFileSync(layoutFile, JSON.stringify(layout));
    await expect(runTool(emitTool, { files: fixturePaths("wav").slice(0, 1), layoutFile, outDir })).rejects.toThrow(/aliases an input file/);
    expect(readFileSync(layoutFile, "utf8")).toBe(JSON.stringify(layout));
    expect(readdirSync(outDir)).toEqual(["capture.md"]);
  });

  it("throws when an EOF repeat item consumes no bytes", async () => {
    const outDir = join(emitRoot, "empty-repeat");
    mkdirSync(outDir);
    const file = join(outDir, "sample.bin");
    const bytes = Uint8Array.of(1, 8, 9);
    writeFileSync(file, bytes);
    const layout = {
      id: "records",
      endian: "le",
      seq: [{ id: "flag", type: "u1" }, { id: "items", type: "item", repeat: "eos" }],
      types: { item: { seq: [{ id: "value", type: "u1", if: "_root.flag == 1" }] } },
    };
    const output = await runTool(emitTool, { files: [file], layout, outDir });
    const parser = (await import(pathToFileURL(output.files.parser).href)) as {
      parseRecords(bytes: Uint8Array): { items: { value?: number }[] };
      ParseError: typeof Error;
      ByteStream: { prototype: { readonly eof: boolean } };
    };
    expect(parser.parseRecords(bytes).items).toEqual([{ value: 8 }, { value: 9 }]);
    const eof = vi.spyOn(parser.ByteStream.prototype, "eof", "get").mockReturnValueOnce(false).mockReturnValue(true);
    try {
      expect(() => parser.parseRecords(Uint8Array.of(0, 8))).toThrow(parser.ParseError);
      expect(() => {
        eof.mockReturnValueOnce(false);
        parser.parseRecords(Uint8Array.of(0, 8));
      }).toThrow(/repeat item consumed 0 bytes/);
    } finally {
      eof.mockRestore();
    }
  });

  it.each(["size", "sizeEos"])("checks contents after reading and inflating a field with %s", async (range) => {
    const outDir = join(emitRoot, `processed-${range}`);
    mkdirSync(outDir);
    const file = join(outDir, "sample.bin");
    const bytes = deflateSync("MAGIC");
    writeFileSync(file, bytes);
    const layout = {
      id: "processed",
      endian: "le",
      seq: [{ id: "data", type: "bytes", ...(range === "size" ? { size: bytes.length } : { sizeEos: true }), process: "zlib", contents: "MAGIC" }],
    };
    const output = await runTool(emitTool, { files: [file], layout, outDir });
    expect(output.verification.fullyRead).toBe(1);
    const parser = (await import(pathToFileURL(output.files.parser).href)) as { parseProcessed(bytes: Uint8Array): { data: Uint8Array } };
    expect(Buffer.from(parser.parseProcessed(bytes).data).toString()).toBe("MAGIC");
    const wrong = deflateSync("wrong");
    expect(() => parser.parseProcessed(wrong)).toThrow(/does not match the expected contents/);
    const parseKaitai = await compileKaitai(output.files.kaitai);
    expect(parseKaitai(bytes)).toMatchObject({ data: Uint8Array.from(Buffer.from("MAGIC")) });
    expect(() => parseKaitai(wrong)).toThrow(expect.objectContaining({ name: "ValidationNotEqualError" }));
    if (range === "sizeEos") {
      const longer = deflateSync("MAGIC plus");
      expect(() => parser.parseProcessed(longer)).toThrow(/does not match the expected contents/);
      expect(() => parseKaitai(longer)).toThrow(expect.objectContaining({ name: "ValidationNotEqualError" }));
    }
  });

  it.each(["root", "nested"])("rejects an early root instance reference from the %s sequence", async (scope) => {
    const outDir = join(emitRoot, `root-reference-${scope}`);
    mkdirSync(outDir);
    const file = join(outDir, "sample.bin");
    const bytes = Uint8Array.of(0x41, 0x42, 2);
    writeFileSync(file, bytes);
    const payload = { id: "payload", type: "bytes", size: "_root.payload_length" };
    const layout = {
      id: "qualified",
      endian: "le",
      ...(scope === "root"
        ? { seq: [payload] }
        : { seq: [{ id: "record", type: "item" }], types: { item: { seq: [payload] } } }),
      instances: { payload_length: { type: "u1", pos: "_io.size - 1" } },
    };
    const verification = verifySample(parseLayout(layout), file, bytes, { includeTree: true, maxArrayItems: 10, maxUnreadRanges: 10 });
    expect(verification.ok).toBe(true);
    await expect(runTool(emitTool, { files: [file], layout, outDir })).rejects.toThrow(/refers to instance _root\.payload_length/);
    expect(readdirSync(outDir)).toEqual(["sample.bin"]);
  });

  it("orders root-qualified dependencies between instances", async () => {
    const outDir = join(emitRoot, "instance-order");
    mkdirSync(outDir);
    const file = join(outDir, "sample.bin");
    const bytes = Uint8Array.of(0x41, 0x42, 2);
    writeFileSync(file, bytes);
    const layout = {
      id: "qualified",
      endian: "le",
      instances: {
        payload: { type: "bytes", pos: 0, size: "_root.payload_length" },
        payload_length: { type: "u1", pos: "_io.size - 1" },
      },
    };
    const output = await runTool(emitTool, { files: [file], layout, outDir });
    const parser = (await import(pathToFileURL(output.files.parser).href)) as { parseQualified(bytes: Uint8Array): { payload: Uint8Array } };
    expect(parser.parseQualified(bytes).payload).toEqual(bytes.subarray(0, 2));
  });

  it("emits a type-checked array containing numbers and bigints for repeated u8 fields", async () => {
    const outDir = join(emitRoot, "wide-repeat");
    mkdirSync(outDir);
    const file = join(outDir, "sample.bin");
    const bytes = Buffer.alloc(16);
    bytes.writeBigUInt64LE(2n);
    bytes.writeBigUInt64LE(2n ** 63n, 8);
    writeFileSync(file, bytes);
    const layout = { id: "wide_repeat", endian: "le", seq: [{ id: "values", type: "u8", repeat: "expr", repeatExpr: 2 }] };
    const output = await runTool(emitTool, { files: [file], layout, outDir });
    expect(typeErrors([output.files.parser, output.files.test])).toEqual([]);
    const parser = (await import(pathToFileURL(output.files.parser).href)) as { parseWideRepeat(bytes: Uint8Array): { values: Array<number | bigint> } };
    expect(parser.parseWideRepeat(bytes).values).toEqual([2, 2n ** 63n]);
  });
});
