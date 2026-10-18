import { formatOffset } from "../core/hex.js";
import { findingId, locationOf, sampleLimits, scoreConfidence, slotEvidence, type Finding } from "./finding.js";
import { describeSlot, distinctCount, readSlotAll, slotOffset, type Sample, type Slot } from "./slots.js";

const maxSizeDifference = 4096;

function constantDifference(samples: Sample[], values: number[]): number | undefined {
  const differences = samples.map((sample, index) => sample.bytes.length - (values[index] ?? 0));
  const [first] = differences;
  if (first === undefined || first < 0 || first > maxSizeDifference) {
    return undefined;
  }
  return differences.every((difference) => difference === first) ? first : undefined;
}

function describeRelation(slot: Slot, difference: number, sample: Sample): string {
  if (difference === 0) {
    return "total file size";
  }
  const fieldEnd = slotOffset(sample, slot) + slot.width;
  if (slot.anchor === "start" && difference === fieldEnd) {
    return `length of the rest of the file after the field (file size minus ${difference})`;
  }
  return `file size minus ${difference}`;
}

export function findFileSizeLengths(samples: Sample[], slots: Slot[]): Finding[] {
  const sizes = samples.map((sample) => sample.bytes.length);
  if (distinctCount(sizes) < 2) {
    return [];
  }
  const findings: Finding[] = [];
  for (const slot of slots) {
    if (slot.width === 1) {
      continue;
    }
    const values = readSlotAll(samples, slot);
    if (!values || distinctCount(values) < 2) {
      continue;
    }
    const difference = constantDifference(samples, values);
    if (difference === undefined) {
      continue;
    }
    const first = samples[0] as Sample;
    const relation = describeRelation(slot, difference, first);
    const isNaturalAnchor = difference === 0 || (slot.anchor === "start" && difference === slot.position + slot.width);
    const raw = 0.6 + (distinctCount(sizes) >= 3 ? 0.25 : 0) + (isNaturalAnchor ? 0.1 : 0);
    findings.push({
      id: findingId("length", slot),
      kind: "length",
      field: locationOf(slot),
      claim: `${describeSlot(slot)} holds the ${relation}`,
      check: `value equals file size minus ${difference} in ${samples.length} of ${samples.length} samples (${distinctCount(sizes)} distinct sizes)`,
      confidence: scoreConfidence(raw, samples.length),
      supportingSamples: samples.map((sample) => sample.file),
      evidence: slotEvidence(samples, slot, values, (index) => `file size ${sizes[index]} - ${difference} = ${values[index]} at ${formatOffset(slotOffset(samples[index] as Sample, slot))}`),
      limits: sampleLimits(samples),
      related: [],
    });
  }
  return findings;
}
