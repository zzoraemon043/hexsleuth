import { formatOffset, isPrintableAscii } from "../core/hex.js";
import { findingId, locationOf, sampleLimits, scoreConfidence, slotEvidence, type Finding } from "./finding.js";
import { magicLength } from "./magic.js";
import { distinctCount, readSlotAll, type Sample, type Slot } from "./slots.js";

const versionWindow = 8;
const maxVersion = 255;
const maxDistinctVersions = 3;

function isSmallVersion(values: number[]): boolean {
  return values.every((value) => value >= 1 && value <= maxVersion) && distinctCount(values) <= maxDistinctVersions;
}

function insidePrintableRun(samples: Sample[], position: number): boolean {
  return samples.every((sample) => {
    let start = position;
    while (start > 0 && isPrintableAscii(sample.bytes[start - 1] ?? 0)) {
      start -= 1;
    }
    let end = position;
    while (end < sample.bytes.length && isPrintableAscii(sample.bytes[end] ?? 0)) {
      end += 1;
    }
    return end - start >= 4 && end > position;
  });
}

function versionSlot(samples: Sample[], position: number, littleEndian: boolean): Slot | undefined {
  const wide: Slot = { anchor: "start", position, width: 2, littleEndian };
  const wideValues = readSlotAll(samples, wide);
  if (wideValues && isSmallVersion(wideValues)) {
    return wide;
  }
  const narrow: Slot = { anchor: "start", position, width: 1, littleEndian: true };
  const narrowValues = readSlotAll(samples, narrow);
  return narrowValues && isSmallVersion(narrowValues) ? narrow : undefined;
}

export function findVersions(
  samples: Sample[],
  covered: (position: number, width: number) => boolean,
  littleEndian: boolean,
  scan: { from: number; to: number },
): Finding[] {
  const start = magicLength(samples);
  const findings: Finding[] = [];
  for (let position = Math.max(start, scan.from); position < Math.min(start + versionWindow, scan.to); position += 1) {
    const slot = versionSlot(samples, position, littleEndian);
    if (!slot || covered(position, slot.width) || insidePrintableRun(samples, position)) {
      continue;
    }
    const values = readSlotAll(samples, slot) ?? [];
    const varies = distinctCount(values) >= 2;
    const raw = 0.3 + (position === start ? 0.2 : 0) + (varies ? 0.15 : 0);
    findings.push({
      id: findingId("version", slot),
      kind: "version",
      field: locationOf(slot),
      claim: `${slot.width === 1 ? "u1" : `u2${littleEndian ? "le" : "be"}`} at ${formatOffset(position)} looks like a version number`,
      check: `small value (${[...new Set(values)].join(", ")}) ${position === start ? "directly after the magic bytes" : `${position - start} bytes after the magic bytes`} in ${samples.length} of ${samples.length} samples`,
      confidence: scoreConfidence(raw, samples.length),
      supportingSamples: samples.map((sample) => sample.file),
      evidence: slotEvidence(samples, slot, values, (index) => `value ${values[index]}`),
      limits: [
        ...sampleLimits(samples),
        varies
          ? "only a few distinct values; flags or type codes look the same"
          : "the value is the same in every sample; samples written by other versions are needed to tell a version from another constant",
      ],
      related: [],
    });
    break;
  }
  return findings;
}
