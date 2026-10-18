import { formatOffset } from "../core/hex.js";
import { readUnsigned } from "../core/scalar.js";

export type Anchor = "start" | "end";
export type SlotWidth = 1 | 2 | 4;

export interface Slot {
  anchor: Anchor;
  position: number;
  width: SlotWidth;
  littleEndian: boolean;
}

export interface Sample {
  file: string;
  bytes: Uint8Array;
}

export function slotOffset(sample: Sample, slot: Slot): number {
  return slot.anchor === "start" ? slot.position : sample.bytes.length - slot.position;
}

export function readSlot(sample: Sample, slot: Slot): number | undefined {
  const offset = slotOffset(sample, slot);
  if (offset < 0 || offset + slot.width > sample.bytes.length) {
    return undefined;
  }
  return readUnsigned(sample.bytes, offset, slot.width, slot.littleEndian);
}

export function readSlotAll(samples: Sample[], slot: Slot): number[] | undefined {
  const values: number[] = [];
  for (const sample of samples) {
    const value = readSlot(sample, slot);
    if (value === undefined) {
      return undefined;
    }
    values.push(value);
  }
  return values;
}

export function slotType(slot: Slot): string {
  if (slot.width === 1) {
    return "u1";
  }
  return `u${slot.width}${slot.littleEndian ? "le" : "be"}`;
}

export function slotLabel(slot: Slot): string {
  return slot.anchor === "start" ? formatOffset(slot.position) : `end-${slot.position}`;
}

export function describeSlot(slot: Slot): string {
  return `${slotType(slot)} at ${slotLabel(slot)}`;
}

export function slotKey(slot: Slot): string {
  return `${slot.anchor}:${slot.position}:${slotType(slot)}`;
}

export interface ScanPlan {
  startFrom: number;
  startTo: number;
  endScanLength: number;
}

export function enumerateSlots(samples: Sample[], plan: ScanPlan, widths: SlotWidth[]): Slot[] {
  const minSize = Math.min(...samples.map((sample) => sample.bytes.length));
  const slots: Slot[] = [];
  for (const width of widths) {
    const endians = width === 1 ? [true] : [true, false];
    for (const littleEndian of endians) {
      for (let position = plan.startFrom; position + width <= Math.min(plan.startTo, minSize); position += 1) {
        slots.push({ anchor: "start", position, width, littleEndian });
      }
      for (let distance = width; distance <= Math.min(plan.endScanLength, minSize); distance += 1) {
        slots.push({ anchor: "end", position: distance, width, littleEndian });
      }
    }
  }
  return slots;
}

export function distinctCount(values: number[]): number {
  return new Set(values).size;
}
