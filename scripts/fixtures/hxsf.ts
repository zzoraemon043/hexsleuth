import { deflateSync } from "node:zlib";
import { ByteWriter } from "./byte-writer.js";
import { randomBytes, randomInt, randomText, type RandomSource } from "./random.js";

export const hxsfHeaderSize = 32;
export const hxsfEntrySize = 20;

export const HxsfKind = { Text: 1, Table: 2, Noise: 3 } as const;
export type HxsfKind = (typeof HxsfKind)[keyof typeof HxsfKind];

export const HxsfCodec = { None: 0, Zlib: 1 } as const;
export type HxsfCodec = (typeof HxsfCodec)[keyof typeof HxsfCodec];

export interface HxsfEntry {
  name: string;
  kind: HxsfKind;
  codec: HxsfCodec;
  content: Uint8Array;
}

export interface HxsfDocument {
  version: number;
  flags: number;
  entries: HxsfEntry[];
}

function encodePool(entries: HxsfEntry[]): { pool: Uint8Array; nameOffsets: number[] } {
  const writer = new ByteWriter();
  const nameOffsets: number[] = [];
  for (const entry of entries) {
    nameOffsets.push(writer.size);
    writer.ascii(entry.name).u8(0);
  }
  return { pool: writer.toBytes(), nameOffsets };
}

export function buildHxsf(document: HxsfDocument): Uint8Array {
  const { pool, nameOffsets } = encodePool(document.entries);
  const storedContents = document.entries.map((entry) =>
    entry.codec === HxsfCodec.Zlib ? new Uint8Array(deflateSync(entry.content)) : entry.content,
  );
  const poolOffset = hxsfHeaderSize + hxsfEntrySize * document.entries.length;
  const dataOffset = poolOffset + pool.length;
  const fileSize = dataOffset + storedContents.reduce((total, stored) => total + stored.length, 0);
  const writer = new ByteWriter()
    .ascii("HXSF")
    .u16le(document.version)
    .u16le(document.flags)
    .u32le(fileSize)
    .u32le(document.entries.length)
    .u32le(hxsfHeaderSize)
    .u32le(poolOffset)
    .u32le(pool.length)
    .u32le(dataOffset);
  let nextDataOffset = dataOffset;
  document.entries.forEach((entry, index) => {
    const stored = storedContents[index] ?? new Uint8Array(0);
    writer
      .u32le(nameOffsets[index] ?? 0)
      .u16le(entry.kind)
      .u16le(entry.codec)
      .u32le(nextDataOffset)
      .u32le(stored.length)
      .u32le(entry.content.length);
    nextDataOffset += stored.length;
  });
  writer.bytes(pool);
  for (const stored of storedContents) {
    writer.bytes(stored);
  }
  return writer.toBytes();
}

function tableContent(random: RandomSource): Uint8Array {
  const writer = new ByteWriter();
  const rows = randomInt(random, 4, 40);
  for (let row = 0; row < rows; row += 1) {
    writer.u16le(row * 10).u16le(randomInt(random, 0, 1000));
  }
  return writer.toBytes();
}

function entryFor(random: RandomSource, sampleIndex: number, entryIndex: number): HxsfEntry {
  const kindCycle = [HxsfKind.Text, HxsfKind.Table, HxsfKind.Text, HxsfKind.Noise] as const;
  const kind: HxsfKind = kindCycle[(sampleIndex + entryIndex) % kindCycle.length] ?? HxsfKind.Text;
  if (kind === HxsfKind.Text) {
    const text = randomText(random, randomInt(random, 200, 1500));
    return { name: `notes-${sampleIndex}-${entryIndex}.txt`, kind, codec: HxsfCodec.Zlib, content: new TextEncoder().encode(text) };
  }
  if (kind === HxsfKind.Table) {
    return { name: `table${entryIndex}.bin`, kind, codec: HxsfCodec.None, content: tableContent(random) };
  }
  return { name: `noise${entryIndex}.bin`, kind, codec: HxsfCodec.None, content: randomBytes(random, randomInt(random, 300, 700)) };
}

export function hxsfDocuments(random: RandomSource): HxsfDocument[] {
  const entryCounts = [1, 3, 2, 5, 4, 6];
  return entryCounts.map((count, sampleIndex) => ({
    version: (sampleIndex % 2) + 1,
    flags: sampleIndex % 3 === 0 ? 1 : 0,
    entries: Array.from({ length: count }, (_, entryIndex) => entryFor(random, sampleIndex, entryIndex)),
  }));
}
