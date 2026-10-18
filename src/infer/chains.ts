import { formatOffset, isPrintableAscii } from "../core/hex.js";
import { readUnsigned } from "../core/scalar.js";
import { findingId, locationOf, sampleLimits, scoreConfidence, type Evidence, type Finding } from "./finding.js";
import { describeSlot, type Sample, type Slot } from "./slots.js";

export interface ChainShape {
  overhead: number;
  lengthFieldOffsetInRecord: number;
  padToEven: boolean;
}

interface Walk {
  lengthPositions: number[];
  values: number[];
  landing: number;
}

const maxExtraOverhead = 32;
const maxLeadingBytes = 8;
const maxHops = 100000;

function walkChain(bytes: Uint8Array, slot: Slot, overhead: number, padToEven: boolean): Walk | undefined {
  const lengthPositions: number[] = [];
  const values: number[] = [];
  let position = slot.position;
  while (position + slot.width <= bytes.length && lengthPositions.length < maxHops) {
    const value = readUnsigned(bytes, position, slot.width, slot.littleEndian);
    const next = position + value + overhead + (padToEven && value % 2 === 1 ? 1 : 0);
    lengthPositions.push(position);
    values.push(value);
    if (next > bytes.length + maxLeadingBytes) {
      return undefined;
    }
    position = next;
  }
  return { lengthPositions, values, landing: position };
}

function tagOf(bytes: Uint8Array, start: number): string | undefined {
  const tag = bytes.subarray(start, start + 4);
  return tag.length === 4 && tag.every((byte) => isPrintableAscii(byte)) ? String.fromCharCode(...tag) : undefined;
}

function tagsFor(bytes: Uint8Array, walk: Walk, relativeTagStart: number): string[] | undefined {
  const tags = walk.lengthPositions.map((position) => tagOf(bytes, position + relativeTagStart));
  return tags.every((tag) => tag !== undefined) ? (tags as string[]) : undefined;
}

function findTagPlacement(samples: Sample[], walks: Walk[], slot: Slot): { relative: number; tags: string[][] } | undefined {
  for (const relative of [slot.width, -4]) {
    const tags = samples.map((sample, index) => tagsFor(sample.bytes, walks[index] as Walk, relative));
    if (tags.every((list) => list !== undefined)) {
      return { relative, tags: tags as string[][] };
    }
  }
  return undefined;
}

function matchShape(samples: Sample[], slot: Slot): { shape: ChainShape; walks: Walk[] } | undefined {
  for (const padToEven of [false, true]) {
    for (let overhead = slot.width; overhead <= slot.width + maxExtraOverhead; overhead += 1) {
      const walks: Walk[] = [];
      for (const sample of samples) {
        const walk = walkChain(sample.bytes, slot, overhead, padToEven);
        if (!walk || walk.landing < sample.bytes.length) {
          break;
        }
        walks.push(walk);
      }
      if (walks.length !== samples.length) {
        continue;
      }
      const leading = walks.map((walk, index) => walk.landing - (samples[index] as Sample).bytes.length);
      const [firstLeading] = leading;
      const consistent = firstLeading !== undefined && leading.every((value) => value === firstLeading) && firstLeading <= slot.position;
      const longEnough = walks.every((walk) => walk.lengthPositions.length >= 2) && walks.some((walk) => walk.lengthPositions.length >= 3);
      if (consistent && longEnough) {
        return { shape: { overhead, lengthFieldOffsetInRecord: firstLeading, padToEven }, walks };
      }
    }
  }
  return undefined;
}

function chainEvidence(samples: Sample[], walks: Walk[], shape: ChainShape, tags: string[][] | undefined): Evidence[] {
  return samples.map((sample, index) => {
    const walk = walks[index] as Walk;
    const start = (walk.lengthPositions[0] ?? 0) - shape.lengthFieldOffsetInRecord;
    const listing = walk.values
      .slice(0, 12)
      .map((value, hop) => (tags ? `${tags[index]?.[hop]}(${value})` : `${value}`))
      .join(", ");
    return {
      sample: sample.file,
      range: { offset: start, length: sample.bytes.length - start },
      value: walk.lengthPositions.length,
      detail: `${walk.lengthPositions.length} records ending exactly at ${sample.bytes.length}: ${listing}${walk.values.length > 12 ? ", ..." : ""}`,
    };
  });
}

export interface ChainFinding extends Finding {
  chain: ChainShape & { recordStart: number; tagOffsetInRecord?: number };
}

export function findRecordChains(samples: Sample[], slots: Slot[], scanLimit: number): ChainFinding[] {
  const findings: ChainFinding[] = [];
  const covered = new Set<string>();
  for (const slot of slots) {
    if (slot.anchor !== "start" || slot.width === 1 || slot.position >= scanLimit) {
      continue;
    }
    const coverageKey = `${slot.width}:${slot.littleEndian}:${slot.position}`;
    if (covered.has(coverageKey)) {
      continue;
    }
    const match = matchShape(samples, slot);
    if (!match) {
      continue;
    }
    for (const walk of match.walks) {
      for (const position of walk.lengthPositions) {
        covered.add(`${slot.width}:${slot.littleEndian}:${position}`);
      }
    }
    const placement = findTagPlacement(samples, match.walks, slot);
    const recordStart = slot.position - match.shape.lengthFieldOffsetInRecord;
    const tagOffsetInRecord = placement ? placement.relative + match.shape.lengthFieldOffsetInRecord : undefined;
    const counts = match.walks.map((walk) => walk.lengthPositions.length);
    const raw = 0.7 + (placement ? 0.15 : 0) + (new Set(counts).size >= 2 ? 0.1 : 0);
    const recordLayout = `each record is value + ${match.shape.overhead} bytes${match.shape.padToEven ? ", padded to an even length" : ""}, with the length field ${match.shape.lengthFieldOffsetInRecord} bytes into the record`;
    findings.push({
      id: findingId("record-chain", slot),
      kind: "record-chain",
      field: locationOf(slot),
      claim: `${describeSlot(slot)} starts a chain of length-prefixed records from ${formatOffset(recordStart)} to the end of the file; ${recordLayout}${placement ? `; each record has a printable 4-byte tag at +${tagOffsetInRecord}` : ""}`,
      check: `walking from ${formatOffset(slot.position)} by value + ${match.shape.overhead} lands exactly on the end of the file in ${samples.length} of ${samples.length} samples (${Math.min(...counts)} to ${Math.max(...counts)} records)`,
      confidence: scoreConfidence(raw, samples.length),
      supportingSamples: samples.map((sample) => sample.file),
      evidence: chainEvidence(samples, match.walks, match.shape, placement?.tags),
      limits: sampleLimits(samples),
      related: [],
      chain: { ...match.shape, recordStart, ...(tagOffsetInRecord === undefined ? {} : { tagOffsetInRecord }) },
    });
  }
  return findings;
}
