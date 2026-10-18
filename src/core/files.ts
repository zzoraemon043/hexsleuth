import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";

export interface ByteRange {
  offset: number;
  length: number;
}

export interface LoadedFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export function loadFile(path: string): LoadedFile {
  if (!statSync(path).isFile()) {
    throw new Error(`${path} is not a regular file`);
  }
  return { path, name: basename(path), bytes: new Uint8Array(readFileSync(path)) };
}

export function clampRange(size: number, offset = 0, length?: number): ByteRange {
  if (offset < 0 || offset > size) {
    throw new RangeError(`offset ${offset} is outside the file (size ${size})`);
  }
  const available = size - offset;
  return { offset, length: length === undefined ? available : Math.min(length, available) };
}
