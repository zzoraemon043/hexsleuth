import { relative } from "node:path";
import type { Layout } from "../layout/schema.js";
import type { SampleVerification } from "../layout/verify.js";
import type { TreeNode } from "../layout/values.js";
import { parseFunctionName } from "./naming.js";

export interface Expectation {
  accessor: string;
  matcher: "toBe" | "toHaveLength";
  value: number | string;
}

const maxExpectationsPerSample = 12;

function accessorFor(path: string[]): string {
  return path
    .map((segment) => {
      const indexed = /^(.*)\[(\d+)\]$/.exec(segment);
      return indexed ? `?.${indexed[1]}?.[${indexed[2]}]` : `?.${segment}`;
    })
    .join("")
    .replace(/^\?\./, "parsed.");
}

function collectExpectations(node: TreeNode, path: string[], output: Expectation[]): void {
  if (output.length >= maxExpectationsPerSample) {
    return;
  }
  if (node.items) {
    output.push({ accessor: accessorFor(path), matcher: "toHaveLength", value: node.items.length + (node.itemsTruncated ?? 0) });
    for (const item of node.items) {
      collectExpectations(item, [...path.slice(0, -1), item.name], output);
    }
    return;
  }
  if (node.fields) {
    for (const field of node.fields) {
      collectExpectations(field, [...path, field.name], output);
    }
    return;
  }
  if (typeof node.value === "number" || typeof node.value === "string") {
    output.push({ accessor: accessorFor(path), matcher: "toBe", value: node.value });
  }
}

export function expectationsFor(tree: TreeNode): Expectation[] {
  const expectations: Expectation[] = [];
  for (const field of tree.fields ?? []) {
    collectExpectations(field, [field.name], expectations);
  }
  return expectations.slice(0, maxExpectationsPerSample);
}

function literal(value: number | string): string {
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

export function emitVitestTest(layout: Layout, parserModule: string, outDir: string, samples: SampleVerification[]): string {
  const parse = parseFunctionName(layout.id);
  const cases = samples.map((sample) => {
    const expectations = sample.tree ? expectationsFor(sample.tree) : [];
    const path = relative(outDir, sample.file).split("\\").join("/");
    const lines = expectations.map((item) => `    expect(${item.accessor}).${item.matcher}(${literal(item.value)});`);
    return [
      `  it(${JSON.stringify(`parses ${path}`)}, () => {`,
      `    const parsed = ${parse}(readSample(${JSON.stringify(path)}));`,
      ...lines,
      "  });",
    ].join("\n");
  });
  return [
    'import { readFileSync } from "node:fs";',
    'import { fileURLToPath } from "node:url";',
    'import { describe, expect, it } from "vitest";',
    `import { ${parse} } from ${JSON.stringify(parserModule)};`,
    "",
    "function readSample(path: string): Uint8Array {",
    "  return new Uint8Array(readFileSync(fileURLToPath(new URL(path, import.meta.url))));",
    "}",
    "",
    `describe(${JSON.stringify(`${layout.id} parser`)}, () => {`,
    cases.join("\n\n"),
    "});",
    "",
  ].join("\n");
}
