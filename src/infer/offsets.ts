import { formatOffset, isPrintableAscii, toHex } from "../core/hex.js";
import type { StrideRelation } from "./counts.js";
import { findingId, locationOf, sampleLimits, scoreConfidence, slotEvidence, type Finding } from "./finding.js";
import { overlaps, sameEncoding, valueKey, type SlotValues, type ValueIndex } from "./slot-table.js";
import { describeSlot, type Sample } from "./slots.js";

interface OffsetSupport {
  weight: number;
  check: string;
  related?: string;
}

const minimumPointer = 4;
const maxTrailerDistance = 64;

function pointsInside(entry: SlotValues, samples: Sample[]): boolean {
  return entry.values.every((value, index) => value >= minimumPointer && value < (samples[index] as Sample).bytes.length);
}

function targetSignature(entry: SlotValues, samples: Sample[]): OffsetSupport | undefined {
  if (!entry.varies) {
    return undefined;
  }
  const targets = samples.map((sample, index) => sample.bytes.subarray(entry.values[index] ?? 0, (entry.values[index] ?? 0) + 4));
  const [first] = targets;
  if (!first || first.length < 4 || first.every((byte) => byte === 0)) {
    return undefined;
  }
  const identical = targets.every((target) => target.length === 4 && target.every((byte, index) => byte === first[index]));
  return identical
    ? { weight: 0.4, check: `points to the same bytes ${toHex(first)} in ${samples.length} of ${samples.length} samples` }
    : undefined;
}

function targetPrintable(entry: SlotValues, samples: Sample[]): OffsetSupport | undefined {
  const printable = samples.every((sample, index) => {
    const target = sample.bytes.subarray(entry.values[index] ?? 0, (entry.values[index] ?? 0) + 4);
    return target.length === 4 && target.every((byte) => isPrintableAscii(byte));
  });
  return printable && entry.varies
    ? { weight: 0.2, check: `points to printable text in ${samples.length} of ${samples.length} samples` }
    : undefined;
}

interface SizePairing {
  support: OffsetSupport;
  size: SlotValues;
  target: string;
}

function pairedSize(entry: SlotValues, samples: Sample[], table: SlotValues[], index: ValueIndex): SizePairing | undefined {
  const first = samples[0] as Sample;
  for (const size of table) {
    if (!size.varies || size === entry || !sameEncoding(size.slot, entry.slot) || overlaps(size.slot, entry.slot, first)) {
      continue;
    }
    const ends = entry.values.map((value, sampleIndex) => value + (size.values[sampleIndex] ?? 0));
    const trailers = ends.map((end, sampleIndex) => (samples[sampleIndex] as Sample).bytes.length - end);
    if (trailers.every((trailer) => trailer === trailers[0]) && (trailers[0] ?? -1) >= 0 && (trailers[0] ?? 0) <= maxTrailerDistance) {
      const target = `file size minus ${trailers[0]}`;
      return {
        size,
        target,
        support: { weight: 0.3, check: `value + ${describeSlot(size.slot)} equals ${target} in ${samples.length} of ${samples.length} samples`, related: findingId("length", size.slot) },
      };
    }
    const endSlot = (index.get(valueKey(entry.slot, ends)) ?? []).find((other) => other !== entry && other !== size);
    if (endSlot) {
      const target = describeSlot(endSlot.slot);
      return {
        size,
        target,
        support: { weight: 0.3, check: `value + ${describeSlot(size.slot)} equals ${target} in ${samples.length} of ${samples.length} samples`, related: findingId("length", size.slot) },
      };
    }
  }
  return undefined;
}

function pairedAsEnd(entry: SlotValues, samples: Sample[], table: SlotValues[], index: ValueIndex): OffsetSupport | undefined {
  const first = samples[0] as Sample;
  for (const start of table) {
    if (!start.varies || start === entry || !sameEncoding(start.slot, entry.slot) || overlaps(start.slot, entry.slot, first)) {
      continue;
    }
    const sizes = entry.values.map((value, sampleIndex) => value - (start.values[sampleIndex] ?? 0));
    if (sizes.some((size) => size <= 0)) {
      continue;
    }
    const size = (index.get(valueKey(entry.slot, sizes)) ?? []).find((candidate) => candidate !== entry && candidate !== start);
    if (size) {
      return {
        weight: 0.25,
        check: `value equals ${describeSlot(start.slot)} + ${describeSlot(size.slot)} in ${samples.length} of ${samples.length} samples, so it marks where that region ends`,
        related: findingId("offset", start.slot),
      };
    }
  }
  return undefined;
}

function strideSupport(entry: SlotValues, relations: StrideRelation[]): OffsetSupport[] {
  const supports: OffsetSupport[] = [];
  for (const relation of relations) {
    if (relation.end === entry && relation.base > 0) {
      supports.push({
        weight: 0.35,
        check: `value equals ${relation.base} + ${relation.recordSize} x ${describeSlot(relation.count.slot)}, the end of a table of ${relation.recordSize}-byte records`,
        related: findingId("count", relation.count.slot),
      });
    }
    if (relation.baseSlot === entry) {
      supports.push({
        weight: 0.45,
        check: `value is where a table of ${describeSlot(relation.count.slot)} x ${relation.recordSize}-byte records starts; the table ends at the offset in ${describeSlot(relation.end.slot)}`,
        related: findingId("count", relation.count.slot),
      });
    }
  }
  return supports;
}

function intrinsicSupports(entry: SlotValues, samples: Sample[], relations: StrideRelation[]): OffsetSupport[] {
  return [targetSignature(entry, samples), targetPrintable(entry, samples), ...strideSupport(entry, relations)].filter(
    (support): support is OffsetSupport => support !== undefined,
  );
}

function isOffsetSide(entry: SlotValues, partner: SlotValues, samples: Sample[], relations: StrideRelation[]): boolean {
  const entryScore = intrinsicSupports(entry, samples, relations).length;
  const partnerScore = intrinsicSupports(partner, samples, relations).length;
  if (entryScore !== partnerScore) {
    return entryScore > partnerScore;
  }
  return entry.values.every((value, index) => value > (partner.values[index] ?? 0));
}

function regionSizeFinding(samples: Sample[], offset: SlotValues, pairing: SizePairing): Finding {
  const { size } = pairing;
  return {
    id: findingId("length", size.slot),
    kind: "length",
    field: locationOf(size.slot),
    claim: `${describeSlot(size.slot)} holds the size of the region that starts at the offset in ${describeSlot(offset.slot)}`,
    check: `${describeSlot(offset.slot)} + value equals ${pairing.target} in ${samples.length} of ${samples.length} samples`,
    confidence: scoreConfidence(0.75, samples.length),
    supportingSamples: samples.map((sample) => sample.file),
    evidence: slotEvidence(samples, size.slot, size.values, (index) => `${offset.values[index]} + ${size.values[index]} = ${(offset.values[index] ?? 0) + (size.values[index] ?? 0)}`),
    limits: sampleLimits(samples),
    related: [findingId("offset", offset.slot)],
  };
}

function offsetFinding(samples: Sample[], entry: SlotValues, supports: OffsetSupport[]): Finding {
  const raw = 0.3 + supports.reduce((total, support) => total + support.weight, 0) + (entry.varies ? 0.05 : 0);
  return {
    id: findingId("offset", entry.slot),
    kind: "offset",
    field: locationOf(entry.slot),
    claim: `${describeSlot(entry.slot)} is an absolute offset that points inside the file`,
    check: supports.map((support) => support.check).join("; "),
    confidence: scoreConfidence(raw, samples.length),
    supportingSamples: samples.map((sample) => sample.file),
    evidence: slotEvidence(samples, entry.slot, entry.values, (index) => {
      const target = entry.values[index] ?? 0;
      const preview = toHex((samples[index] as Sample).bytes.subarray(target, target + 4));
      return `points to ${formatOffset(target)} of ${(samples[index] as Sample).bytes.length} bytes, which starts with ${preview}`;
    }),
    limits: [
      ...sampleLimits(samples),
      ...(entry.varies ? [] : ["value is the same in every sample, so it may be a constant that happens to fall inside the file"]),
    ],
    related: supports.flatMap((support) => (support.related ? [support.related] : [])),
  };
}

export function findOffsets(
  samples: Sample[],
  table: SlotValues[],
  index: ValueIndex,
  relations: StrideRelation[],
): Finding[] {
  const findings: Finding[] = [];
  for (const entry of table) {
    if (entry.slot.width === 1 || !pointsInside(entry, samples)) {
      continue;
    }
    const intrinsic = intrinsicSupports(entry, samples, relations);
    const pairing = entry.varies ? pairedSize(entry, samples, table, index) : undefined;
    const usePairing = pairing !== undefined && isOffsetSide(entry, pairing.size, samples, relations);
    const asEnd = entry.varies ? pairedAsEnd(entry, samples, table, index) : undefined;
    const supports = [...intrinsic, ...(usePairing ? [pairing.support] : []), ...(asEnd ? [asEnd] : [])];
    const hasStructuralSupport = supports.some((support) => !support.check.startsWith("points to printable"));
    if (!hasStructuralSupport) {
      continue;
    }
    findings.push(offsetFinding(samples, entry, supports));
    if (usePairing) {
      findings.push(regionSizeFinding(samples, entry, pairing));
    }
  }
  return findings;
}
