import { crc32, deflateRawSync } from "node:zlib";
import { ByteWriter } from "./byte-writer.js";

export interface ZipEntry {
  name: string;
  content: string;
  method: 0 | 8;
}

const dosTime = 0x6000;
const dosDate = 0x5a21;
const versionNeeded = 20;

interface StoredEntry {
  entry: ZipEntry;
  nameBytes: Uint8Array;
  stored: Uint8Array;
  checksum: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function prepare(entry: ZipEntry): Omit<StoredEntry, "localHeaderOffset"> {
  const raw = new TextEncoder().encode(entry.content);
  const stored = entry.method === 8 ? new Uint8Array(deflateRawSync(raw)) : raw;
  return { entry, nameBytes: new TextEncoder().encode(entry.name), stored, checksum: crc32(raw), uncompressedSize: raw.length };
}

function writeCommonHeader(writer: ByteWriter, item: StoredEntry): void {
  writer
    .u16le(0)
    .u16le(item.entry.method)
    .u16le(dosTime)
    .u16le(dosDate)
    .u32le(item.checksum)
    .u32le(item.stored.length)
    .u32le(item.uncompressedSize)
    .u16le(item.nameBytes.length)
    .u16le(0);
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const writer = new ByteWriter();
  const items: StoredEntry[] = [];
  for (const entry of entries) {
    const item = { ...prepare(entry), localHeaderOffset: writer.size };
    items.push(item);
    writer.u32le(0x04034b50).u16le(versionNeeded);
    writeCommonHeader(writer, item);
    writer.bytes(item.nameBytes).bytes(item.stored);
  }
  const centralDirectoryOffset = writer.size;
  for (const item of items) {
    writer.u32le(0x02014b50).u16le(versionNeeded).u16le(versionNeeded);
    writeCommonHeader(writer, item);
    writer.u16le(0).u16le(0).u16le(0).u32le(0).u32le(item.localHeaderOffset).bytes(item.nameBytes);
  }
  const centralDirectorySize = writer.size - centralDirectoryOffset;
  writer
    .u32le(0x06054b50)
    .u16le(0)
    .u16le(0)
    .u16le(items.length)
    .u16le(items.length)
    .u32le(centralDirectorySize)
    .u32le(centralDirectoryOffset)
    .u16le(0);
  return writer.toBytes();
}
