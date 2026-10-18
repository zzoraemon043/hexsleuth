import { roundTo } from "../core/entropy.js";
import { slotKey, slotLabel, slotOffset, slotType, type Sample, type Slot } from "./slots.js";

export const findingKinds = ["magic", "length", "record-chain", "count", "offset", "version", "endianness"] as const;

export type FindingKind = (typeof findingKinds)[number];

export interface Evidence {
  sample: string;
  range: { offset: number; length: number };
  value?: number;
  detail: string;
}

export interface FieldLocation {
  anchor: "start" | "end";
  position: number;
  label: string;
  type: string;
}

export interface Finding {
  id: string;
  kind: FindingKind;
  field?: FieldLocation;
  claim: string;
  check: string;
  confidence: number;
  supportingSamples: string[];
  evidence: Evidence[];
  limits: string[];
  related: string[];
}

export function sampleCountFactor(sampleCount: number): number {
  if (sampleCount >= 3) {
    return 1;
  }
  return sampleCount === 2 ? 0.8 : 0.6;
}

export function scoreConfidence(raw: number, sampleCount: number): number {
  return roundTo(Math.max(0, Math.min(0.99, raw * sampleCountFactor(sampleCount))), 2);
}

export function sampleLimits(samples: Sample[]): string[] {
  const limits: string[] = [];
  if (samples.length < 3) {
    limits.push(`only ${samples.length} sample${samples.length === 1 ? "" : "s"}; add more samples to raise confidence`);
  }
  return limits;
}

export function locationOf(slot: Slot): FieldLocation {
  return { anchor: slot.anchor, position: slot.position, label: slotLabel(slot), type: slotType(slot) };
}

export function findingId(kind: FindingKind, slot: Slot): string {
  return `${kind}@${slotKey(slot)}`;
}

export function slotEvidence(samples: Sample[], slot: Slot, values: number[], detail: (index: number) => string): Evidence[] {
  return samples.map((sample, index) => ({
    sample: sample.file,
    range: { offset: slotOffset(sample, slot), length: slot.width },
    value: values[index] ?? 0,
    detail: detail(index),
  }));
}
