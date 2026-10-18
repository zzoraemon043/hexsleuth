import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { parse as parseYaml } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectationsFor } from "../src/emit/vitest-test.js";
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
      expect(Object.values(output.files).map((path) => path.split("/").at(-1))).toEqual([`${format}.md`, `${format}.ksy`, `${format}.ts`, `${format}.test.ts`]);
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
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    expect(diagnostics).toEqual([]);
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

  it("emits Vitest tests that pass when run on their own", () => {
    const reportPath = join(emitRoot, "report.json");
    const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--root", emitRoot, "--reporter", "json", "--outputFile", reportPath], {
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { numTotalTests: number; numPassedTests: number; numFailedTests: number };
    expect(report.numFailedTests).toBe(0);
    expect(report.numTotalTests).toBe(exampleFormats.length * 6);
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
