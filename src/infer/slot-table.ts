import { distinctCount, readSlotAll, type Sample, type Slot } from "./slots.js";

export interface SlotValues {
  slot: Slot;
  values: number[];
  varies: boolean;
}

export function buildSlotTable(samples: Sample[], slots: Slot[]): SlotValues[] {
  const table: SlotValues[] = [];
  for (const slot of slots) {
    const values = readSlotAll(samples, slot);
    if (values) {
      table.push({ slot, values, varies: distinctCount(values) >= 2 });
    }
  }
  return table;
}

export function sameEncoding(left: Slot, right: Slot): boolean {
  return left.width === right.width && left.littleEndian === right.littleEndian;
}

export function overlaps(left: Slot, right: Slot, sample: Sample): boolean {
  const leftStart = left.anchor === "start" ? left.position : sample.bytes.length - left.position;
  const rightStart = right.anchor === "start" ? right.position : sample.bytes.length - right.position;
  return leftStart < rightStart + right.width && rightStart < leftStart + left.width;
}

export type ValueIndex = Map<string, SlotValues[]>;

function encodingKey(slot: Slot): string {
  return `${slot.width}:${slot.littleEndian}`;
}

export function valueKey(slot: Slot, values: number[]): string {
  return `${encodingKey(slot)}|${values.join(",")}`;
}

export function buildValueIndex(table: SlotValues[]): ValueIndex {
  const index: ValueIndex = new Map();
  for (const entry of table) {
    if (!entry.varies) {
      continue;
    }
    const key = valueKey(entry.slot, entry.values);
    index.set(key, [...(index.get(key) ?? []), entry]);
  }
  return index;
}
