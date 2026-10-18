import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Layout } from "../layout/schema.js";
import { verifySample, type SampleVerification } from "../layout/verify.js";
import { entropyNotes } from "./entropy-notes.js";
import { emitKaitaiStruct } from "./kaitai.js";
import { emitMarkdownSpec, type EvidenceNote } from "./markdown.js";
import { EmitError } from "./naming.js";
import { emitTypeScriptParser } from "./typescript-parser.js";
import { emitVitestTest } from "./vitest-test.js";

export interface EmitSample {
  file: string;
  bytes: Uint8Array;
}

export interface EmittedFiles {
  spec: string;
  kaitai: string;
  parser: string;
  test: string;
}

export interface EmitResult {
  files: EmittedFiles;
  samples: SampleVerification[];
}

export function emitArtifacts(layout: Layout, samples: EmitSample[], outDir: string, evidence: EvidenceNote[], allowFailures: boolean): EmitResult {
  const directory = resolve(outDir);
  const verified = samples.map((sample) => verifySample(layout, sample.file, sample.bytes, { includeTree: true, maxArrayItems: Number.MAX_SAFE_INTEGER, maxUnreadRanges: 50 }));
  const failures = verified.filter((sample) => !sample.ok);
  if (failures.length > 0 && !allowFailures) {
    throw new EmitError(
      `the layout does not parse ${failures.length} of ${verified.length} samples: ${failures.map((sample) => `${sample.file} at ${sample.error?.path}: ${sample.error?.message}`).join("; ")}`,
    );
  }
  const parser = emitTypeScriptParser(layout);
  const kaitai = emitKaitaiStruct(layout);
  const parsedSamples = verified.filter((sample) => sample.ok);
  const testSamples = parsedSamples.map((sample) => ({ ...sample, file: resolve(sample.file) }));
  const test = emitVitestTest(layout, `./${layout.id}.js`, directory, testSamples);
  const entropy = samples.flatMap((sample, index) => entropyNotes(sample.file, sample.bytes, verified[index]?.tree));
  const spec = emitMarkdownSpec({ layout, samples: verified, evidence, entropy });
  mkdirSync(directory, { recursive: true });
  const files: EmittedFiles = {
    spec: join(directory, `${layout.id}.md`),
    kaitai: join(directory, `${layout.id}.ksy`),
    parser: join(directory, `${layout.id}.ts`),
    test: join(directory, `${layout.id}.test.ts`),
  };
  writeFileSync(files.spec, spec);
  writeFileSync(files.kaitai, kaitai);
  writeFileSync(files.parser, parser);
  writeFileSync(files.test, test);
  return { files, samples: verified };
}
