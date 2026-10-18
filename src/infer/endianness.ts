import { sampleLimits, scoreConfidence, type Evidence, type Finding } from "./finding.js";
import type { SlotValues } from "./slot-table.js";
import { slotOffset, type Sample } from "./slots.js";

interface Vote {
  littleEndian: boolean;
  weight: number;
  reason: string;
  evidence: Evidence;
}

const smallValueLimit = 2 ** 20;
const largeValueLimit = 2 ** 24;
const magnitudeWindow = 64;

function structuralVotes(findings: Finding[]): Vote[] {
  return findings
    .filter((finding) => finding.field && finding.field.type !== "u1" && finding.confidence >= 0.5 && ["length", "record-chain", "count", "offset"].includes(finding.kind))
    .map((finding) => ({
      littleEndian: finding.field?.type.endsWith("le") ?? true,
      weight: 1,
      reason: `${finding.kind} ${finding.field?.type} at ${finding.field?.label}`,
      evidence: { sample: finding.supportingSamples[0] ?? "", range: finding.evidence[0]?.range ?? { offset: 0, length: 0 }, detail: `${finding.id} (confidence ${finding.confidence})` },
    }));
}

function magnitudeVotes(samples: Sample[], table: SlotValues[]): Vote[] {
  const votes: Vote[] = [];
  const little = table.filter((entry) => entry.slot.width === 4 && entry.slot.littleEndian && entry.slot.anchor === "start" && entry.slot.position < magnitudeWindow && entry.slot.position % 4 === 0 && entry.varies);
  for (const entry of little) {
    const big = table.find((other) => other.slot.width === 4 && !other.slot.littleEndian && other.slot.anchor === "start" && other.slot.position === entry.slot.position);
    if (!big) {
      continue;
    }
    const littleSmall = entry.values.every((value) => value < smallValueLimit);
    const bigSmall = big.values.every((value) => value < smallValueLimit);
    const littleLarge = entry.values.some((value) => value >= largeValueLimit);
    const bigLarge = big.values.some((value) => value >= largeValueLimit);
    if (littleSmall !== bigSmall && (littleLarge || bigLarge)) {
      const first = samples[0] as Sample;
      votes.push({
        littleEndian: littleSmall,
        weight: 0.5,
        reason: `varying 4-byte value at ${entry.slot.position} is small only when read as ${littleSmall ? "little" : "big"}-endian`,
        evidence: { sample: first.file, range: { offset: slotOffset(first, entry.slot), length: 4 }, detail: `little-endian ${entry.values[0]}, big-endian ${big.values[0]}` },
      });
    }
  }
  return votes;
}

export function findEndianness(samples: Sample[], findings: Finding[], table: SlotValues[]): Finding | undefined {
  const structural = structuralVotes(findings);
  const votes = structural.length > 0 ? structural : magnitudeVotes(samples, table);
  const total = votes.reduce((sum, vote) => sum + vote.weight, 0);
  if (total === 0) {
    return undefined;
  }
  const littleWeight = votes.filter((vote) => vote.littleEndian).reduce((sum, vote) => sum + vote.weight, 0);
  const littleEndian = littleWeight >= total - littleWeight;
  const winning = votes.filter((vote) => vote.littleEndian === littleEndian);
  const share = (littleEndian ? littleWeight : total - littleWeight) / total;
  const raw = share * (0.6 + 0.35 * Math.min(1, total / 3));
  return {
    id: "endianness@file",
    kind: "endianness",
    claim: `multi-byte integers are ${littleEndian ? "little" : "big"}-endian`,
    check: `${winning.length} of ${votes.length} signals agree (weighted ${share.toFixed(2)}): ${winning.slice(0, 6).map((vote) => vote.reason).join("; ")}`,
    confidence: scoreConfidence(raw, samples.length),
    supportingSamples: samples.map((sample) => sample.file),
    evidence: winning.slice(0, 10).map((vote) => vote.evidence),
    limits: [...sampleLimits(samples), ...(total < 2 ? ["based on a single signal"] : [])],
    related: [],
  };
}
