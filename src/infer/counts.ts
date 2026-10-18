import { formatOffset, toHex } from "../core/hex.js";
import { findingId, locationOf, sampleLimits, scoreConfidence, slotEvidence, type Finding } from "./finding.js";
import { overlaps, sameEncoding, type SlotValues } from "./slot-table.js";
import { describeSlot, distinctCount, type Sample } from "./slots.js";

export interface StrideRelation {
  count: SlotValues;
  end: SlotValues;
  recordSize: number;
  base: number;
  baseSlot?: SlotValues;
}

const minRecordSize = 2;
const maxRecordSize = 1024;
const minDistinctCountsWithoutBase = 3;
const maxCount = 65535;

function isCountLike(entry: SlotValues): boolean {
  return entry.varies && entry.values.every((value) => value >= 0 && value <= maxCount);
}

function strideBetween(count: number[], end: number[]): { recordSize: number; base: number } | undefined {
  const pairIndex = count.findIndex((value) => value !== count[0]);
  if (pairIndex < 0) {
    return undefined;
  }
  const countDelta = (count[pairIndex] ?? 0) - (count[0] ?? 0);
  const endDelta = (end[pairIndex] ?? 0) - (end[0] ?? 0);
  if (endDelta % countDelta !== 0) {
    return undefined;
  }
  const recordSize = endDelta / countDelta;
  if (recordSize < minRecordSize || recordSize > maxRecordSize) {
    return undefined;
  }
  const base = (end[0] ?? 0) - (count[0] ?? 0) * recordSize;
  const consistent = count.every((value, index) => (end[index] ?? 0) - value * recordSize === base);
  return consistent && base >= 0 ? { recordSize, base } : undefined;
}

function relationStrength(relation: StrideRelation): number {
  return (relation.baseSlot ? 100 : 0) + (relation.base > 0 ? 10 : 0) + relation.end.slot.width;
}

function keepWidestCount(relations: StrideRelation[]): StrideRelation[] {
  const byShape = new Map<string, StrideRelation>();
  for (const relation of relations) {
    const key = `${relation.end.slot.anchor}:${relation.end.slot.position}:${relation.recordSize}:${relation.base}:${relation.count.slot.position}`;
    const existing = byShape.get(key);
    if (!existing || relation.count.slot.width > existing.count.slot.width) {
      byShape.set(key, relation);
    }
  }
  return [...byShape.values()];
}

export function findStrideRelations(samples: Sample[], table: SlotValues[]): StrideRelation[] {
  const first = samples[0] as Sample;
  const relations: StrideRelation[] = [];
  for (const count of table.filter(isCountLike)) {
    let best: StrideRelation | undefined;
    for (const end of table) {
      const sameByteOrder = count.slot.width === 1 || end.slot.littleEndian === count.slot.littleEndian;
      if (!end.varies || end === count || end.slot.width === 1 || !sameByteOrder || overlaps(count.slot, end.slot, first)) {
        continue;
      }
      if (!end.values.every((value, index) => value <= (samples[index] as Sample).bytes.length)) {
        continue;
      }
      const stride = strideBetween(count.values, end.values);
      if (!stride) {
        continue;
      }
      const baseSlot = table.find(
        (entry) => !entry.varies && entry.values[0] === stride.base && sameEncoding(entry.slot, end.slot) && stride.base > 0,
      );
      if (stride.base === 0 && distinctCount(count.values) < minDistinctCountsWithoutBase) {
        continue;
      }
      const relation: StrideRelation = { count, end, ...stride, ...(baseSlot ? { baseSlot } : {}) };
      if (!best || relationStrength(relation) > relationStrength(best)) {
        best = relation;
      }
    }
    if (best) {
      relations.push(best);
    }
  }
  return keepWidestCount(relations);
}

export function strideCountFindings(samples: Sample[], relations: StrideRelation[]): Finding[] {
  return relations.map((relation) => {
    const { count, end, recordSize, base } = relation;
    const raw = 0.55 + (distinctCount(count.values) >= 3 ? 0.2 : 0) + (relation.baseSlot ? 0.15 : 0);
    const baseText = relation.baseSlot ? `${describeSlot(relation.baseSlot.slot)} (${base})` : `${base}`;
    const claim =
      base === 0
        ? `${describeSlot(count.slot)} counts ${recordSize}-byte records whose total size is in ${describeSlot(end.slot)}`
        : `${describeSlot(count.slot)} counts ${recordSize}-byte records in a table that starts at ${baseText} and ends at the offset in ${describeSlot(end.slot)}`;
    return {
      id: findingId("count", count.slot),
      kind: "count",
      field: locationOf(count.slot),
      claim,
      check: `${describeSlot(end.slot)} equals ${base} + ${recordSize} x value in ${samples.length} of ${samples.length} samples (${distinctCount(count.values)} distinct counts)`,
      confidence: scoreConfidence(raw, samples.length),
      supportingSamples: samples.map((sample) => sample.file),
      evidence: slotEvidence(samples, count.slot, count.values, (index) => `${base} + ${recordSize} x ${count.values[index]} = ${end.values[index]}`),
      limits: sampleLimits(samples),
      related: [findingId("offset", end.slot), ...(relation.baseSlot ? [findingId("offset", relation.baseSlot.slot)] : [])],
    };
  });
}

function gramKey(bytes: Uint8Array, index: number): number {
  return (((bytes[index] ?? 0) << 24) | ((bytes[index + 1] ?? 0) << 16) | ((bytes[index + 2] ?? 0) << 8) | (bytes[index + 3] ?? 0)) >>> 0;
}

function gramCounts(bytes: Uint8Array): Map<number, number> {
  const counts = new Map<number, number>();
  for (let index = 0; index + 4 <= bytes.length; index += 1) {
    const key = gramKey(bytes, index);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isUniformGram(key: number): boolean {
  const low = key & 0xff;
  return ((key >>> 8) & 0xff) === low && ((key >>> 16) & 0xff) === low && key >>> 24 === low;
}

function patternCountTable(samples: Sample[]): { pattern: Uint8Array; counts: number[] }[] {
  const perSample = samples.map((sample) => gramCounts(sample.bytes));
  const [firstCounts, ...otherCounts] = perSample;
  const table: { pattern: Uint8Array; counts: number[] }[] = [];
  for (const [key, count] of firstCounts ?? new Map<number, number>()) {
    if (isUniformGram(key) || !otherCounts.every((counts) => counts.has(key))) {
      continue;
    }
    const counts = [count, ...otherCounts.map((counts) => counts.get(key) ?? 0)];
    if (distinctCount(counts) >= 2) {
      table.push({ pattern: Uint8Array.of(key >>> 24, (key >>> 16) & 0xff, (key >>> 8) & 0xff, key & 0xff), counts });
    }
  }
  return table;
}

function markerScore(pattern: Uint8Array): number {
  return pattern.filter((byte) => byte >= 0x41 && byte <= 0x5a).length + (pattern[0] === pattern[1] ? 0 : 1);
}

export function occurrenceCountFindings(samples: Sample[], table: SlotValues[]): Finding[] {
  const countSlots = table.filter((entry) => isCountLike(entry) && entry.values.every((value) => value >= 1 && value <= 4096));
  if (countSlots.length === 0 || samples.length < 2) {
    return [];
  }
  const patternCounts = patternCountTable(samples);
  const findings: Finding[] = [];
  for (const slotEntry of countSlots) {
    const match = patternCounts
      .filter((entry) => entry.counts.every((value, index) => value === slotEntry.values[index]))
      .sort((left, right) => markerScore(right.pattern) - markerScore(left.pattern))[0];
    if (!match) {
      continue;
    }
    const raw = 0.5 + (distinctCount(slotEntry.values) >= 3 ? 0.2 : 0);
    const patternHex = toHex(match.pattern);
    findings.push({
      id: findingId("count", slotEntry.slot),
      kind: "count",
      field: locationOf(slotEntry.slot),
      claim: `${describeSlot(slotEntry.slot)} counts records marked by the byte sequence ${patternHex}`,
      check: `value equals the number of occurrences of ${patternHex} in ${samples.length} of ${samples.length} samples (${distinctCount(slotEntry.values)} distinct counts)`,
      confidence: scoreConfidence(raw, samples.length),
      supportingSamples: samples.map((sample) => sample.file),
      evidence: slotEvidence(samples, slotEntry.slot, slotEntry.values, (index) => `${match.counts[index]} occurrences of ${patternHex}; field at ${formatOffset(slotEntry.slot.position)} from the ${slotEntry.slot.anchor}`),
      limits: [...sampleLimits(samples), "the marker could also appear inside data by chance; confirm with an offset table or a layout"],
      related: [],
    });
  }
  return findings;
}
