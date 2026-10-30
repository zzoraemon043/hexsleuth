import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    const compiler = requireFromRepository("kaitai-struct-compiler") as { compile(language: string, ksy: unknown, importer: null, debug: boolean): Promise<Record<string, string>> };
    const kaitaiStream = requireFromRepository("kaitai-struct/KaitaiStream") as new (buffer: ArrayBuffer) => unknown;
    for (const format of exampleFormats) {
      const ksy: unknown = parseYaml(readFileSync(emitted(format).files.kaitai, "utf8"));
      const compiled = await compiler.compile("javascript", ksy, null, false);
      const [source] = Object.values(compiled);
      const moduleExports: Record<string, new (stream: unknown) => unknown> = {};
      new Function("exports", "require", source ?? "")(moduleExports, requireFromRepository);
      const KaitaiType = Object.values(moduleExports)[0];
      expect(KaitaiType, format).toBeTypeOf("function");
      for (const { file, expectations } of expectedValues(format)) {
        const bytes = readFixture(file);
        const parsed = new (KaitaiType as new (stream: unknown) => unknown)(new kaitaiStream(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
        for (const expectation of expectations) {
          const actual = evaluateAccessor(parsed, camelCaseAccessor(expectation.accessor));
          const measured = expectation.matcher === "toHaveLength" ? (actual as unknown[]).length : actual;
          expect(measured, `kaitai ${file} ${expectation.accessor}`).toBe(expectation.value);
        }
      }
    }
  });
});
