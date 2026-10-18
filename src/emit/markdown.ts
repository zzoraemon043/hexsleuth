import { instanceFields, rootType, type Layout, type NamedField, type TypeSpec } from "../layout/schema.js";
import { contentsBytes, parseScalarType } from "../layout/types.js";
import type { SampleVerification } from "../layout/verify.js";
import { formatOffset, toHex } from "../core/hex.js";

export interface EvidenceNote {
  claim: string;
  check: string;
  confidence: number;
}

export interface EntropyNote {
  file: string;
  offset: number;
  length: number;
  classification: string;
  field: string | null;
}

export interface SpecInput {
  layout: Layout;
  samples: SampleVerification[];
  evidence: EvidenceNote[];
  entropy: EntropyNote[];
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function code(text: string | number): string {
  return `\`${String(text)}\``;
}

function fixedSize(field: NamedField): number | undefined {
  if (field.repeat !== undefined || field.if !== undefined) {
    return undefined;
  }
  const scalar = parseScalarType(field.type);
  if (scalar) {
    return scalar.width;
  }
  if (field.contents !== undefined) {
    return contentsBytes(field.contents).length;
  }
  return typeof field.size === "number" ? field.size : undefined;
}

function typeLabel(field: NamedField, layout: Layout): string {
  const scalar = parseScalarType(field.type);
  if (scalar && scalar.endian === null) {
    return `${field.type}${field.endian ?? layout.endian}`;
  }
  return field.type;
}

function notes(field: NamedField): string {
  const parts: string[] = [];
  if (field.contents !== undefined) {
    parts.push(`must equal ${code(toHex(contentsBytes(field.contents)))}`);
  }
  if (field.size !== undefined) {
    parts.push(`size ${code(field.size)}`);
  }
  if (field.sizeEos) {
    parts.push("to the end of the stream");
  }
  if (field.encoding) {
    parts.push(field.encoding);
  }
  if (field.repeat === "expr") {
    parts.push(`repeated ${code(field.repeatExpr ?? 0)} times`);
  }
  if (field.repeat === "eos") {
    parts.push("repeated to the end of the stream");
  }
  if (field.if !== undefined) {
    parts.push(`only if ${code(field.if)}`);
  }
  if (field.process) {
    parts.push(`${field.process} compressed`);
  }
  if (field.doc) {
    parts.push(field.doc);
  }
  return parts.join("; ");
}

function sequenceTable(spec: TypeSpec, layout: Layout): string[] {
  if (spec.seq.length === 0) {
    return ["No sequential fields."];
  }
  const rows = ["| Offset | Field | Type | Size | Notes |", "| --- | --- | --- | --- | --- |"];
  let offset: number | undefined = 0;
  for (const field of spec.seq) {
    const size = fixedSize(field);
    rows.push(`| ${offset === undefined ? "varies" : formatOffset(offset)} | ${code(field.id)} | ${code(typeLabel(field, layout))} | ${size ?? "varies"} | ${cell(notes(field))} |`);
    offset = offset !== undefined && size !== undefined ? offset + size : undefined;
  }
  return rows;
}

function instanceTable(spec: TypeSpec, layout: Layout): string[] {
  const instances = instanceFields(spec.instances);
  if (instances.length === 0) {
    return [];
  }
  return [
    "",
    "Fields read at a position:",
    "",
    "| Field | Position | Type | Notes |",
    "| --- | --- | --- | --- |",
    ...instances.map((instance) => `| ${code(instance.id)} | ${code(instance.pos ?? 0)} | ${code(typeLabel(instance, layout))} | ${cell(notes(instance))} |`),
  ];
}

function typeSection(name: string, spec: TypeSpec, layout: Layout, heading: string): string[] {
  return [heading, "", ...(spec.doc ? [spec.doc, ""] : []), ...sequenceTable(spec, layout), ...instanceTable(spec, layout), ""];
}

function verificationSection(samples: SampleVerification[]): string[] {
  const parsed = samples.filter((sample) => sample.ok).length;
  const fullyRead = samples.filter((sample) => sample.ok && sample.unreadBytes === 0).length;
  return [
    "## Verification",
    "",
    `The layout parsed ${parsed} of ${samples.length} samples; ${fullyRead} of them were read completely.`,
    "",
    "| Sample | Size | Read | Unread | Result |",
    "| --- | --- | --- | --- | --- |",
    ...samples.map(
      (sample) =>
        `| ${code(sample.file)} | ${sample.size} | ${sample.readBytes} | ${sample.unreadBytes} | ${sample.ok ? "parsed" : cell(`failed at ${sample.error?.path}: ${sample.error?.message}`)} |`,
    ),
    "",
  ];
}

function evidenceSection(evidence: EvidenceNote[]): string[] {
  if (evidence.length === 0) {
    return [];
  }
  return [
    "## Evidence",
    "",
    "| Claim | Check | Confidence |",
    "| --- | --- | --- |",
    ...evidence.map((item) => `| ${cell(item.claim)} | ${cell(item.check)} | ${item.confidence.toFixed(2)} |`),
    "",
  ];
}

function entropySection(entropy: EntropyNote[]): string[] {
  if (entropy.length === 0) {
    return [];
  }
  return [
    "## High-entropy regions",
    "",
    "Regions classified as `possibly-encrypted` were not analyzed further. hexsleuth does not attempt decryption, key search or XOR guessing.",
    "",
    "| Sample | Range | Classification | Field |",
    "| --- | --- | --- | --- |",
    ...entropy.map(
      (item) => `| ${code(item.file)} | ${formatOffset(item.offset)} to ${formatOffset(item.offset + item.length)} | ${item.classification} | ${item.field ? code(item.field) : "none"} |`,
    ),
    "",
  ];
}

export function emitMarkdownSpec(input: SpecInput): string {
  const { layout } = input;
  const lines = [
    `# ${layout.title ?? layout.id}`,
    "",
    ...(layout.doc ? [layout.doc, ""] : []),
    `- Identifier: ${code(layout.id)}`,
    `- Default byte order: ${layout.endian === "le" ? "little-endian" : "big-endian"}`,
    ...(layout.fileExtension ? [`- File extension: ${code(layout.fileExtension)}`] : []),
    "",
    ...typeSection(layout.id, { ...rootType(layout), doc: undefined }, layout, "## File structure"),
    ...Object.entries(layout.types ?? {}).flatMap(([name, spec]) => typeSection(name, spec, layout, `## Type ${code(name)}`)),
    ...verificationSection(input.samples),
    ...evidenceSection(input.evidence),
    ...entropySection(input.entropy),
  ];
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
