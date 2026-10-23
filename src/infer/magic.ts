import { toAsciiPreview, toHex } from "../core/hex.js";
import { findMagic, isKnownSignature } from "../core/signatures.js";
import { sampleLimits, scoreConfidence, type Finding } from "./finding.js";
import type { Sample } from "./slots.js";

export function commonPrefixLength(samples: Sample[]): number {
  const minSize = Math.min(...samples.map((sample) => sample.bytes.length));
  const first = samples[0] as Sample;
  let length = 0;
  while (length < minSize && samples.every((sample) => sample.bytes[length] === first.bytes[length])) {
    length += 1;
  }
  return length;
}

export function magicLength(samples: Sample[]): number {
  const first = samples[0] as Sample;
  const common = commonPrefixLength(samples);
  const known = findMagic(first.bytes, 0).find((candidate) => candidate.offset === 0);
  if (known) {
    return Math.min(common, known.bytes.split(" ").length);
  }
  return Math.min(common, 4);
}

export function findMagicFinding(samples: Sample[]): Finding | undefined {
  const length = magicLength(samples);
  if (length < 2) {
    return undefined;
  }
  const first = samples[0] as Sample;
  const bytes = first.bytes.subarray(0, length);
  const known = findMagic(first.bytes, 0).find((candidate) => candidate.offset === 0 && isKnownSignature(candidate));
  const raw = 0.6 + (length >= 4 ? 0.2 : 0) + (known ? 0.15 : 0);
  return {
    id: "magic@start:0",
    kind: "magic",
    field: { anchor: "start", position: 0, label: "0x0000", type: `bytes[${length}]` },
    claim: `the file starts with the magic bytes ${toHex(bytes)} ("${toAsciiPreview(bytes)}")${known ? `, a known signature: ${known.name}` : ""}`,
    check: `bytes 0 to ${length - 1} are identical in ${samples.length} of ${samples.length} samples`,
    confidence: scoreConfidence(raw, samples.length),
    supportingSamples: samples.map((sample) => sample.file),
    evidence: samples.map((sample) => ({ sample: sample.file, range: { offset: 0, length }, detail: toHex(sample.bytes.subarray(0, length)) })),
    limits: sampleLimits(samples),
    related: [],
  };
}
