import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, inflateRawSync, inflateSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { generateFixtures } from "../scripts/fixtures/index.js";
import { fixtureManifest, fixturePaths, readFixture } from "./helpers.js";

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder("latin1").decode(bytes.subarray(start, start + length));
}

describe("fixture generation", () => {
  it("produces at least five distinct samples per format", () => {
    const manifest = fixtureManifest();
    expect(Object.keys(manifest).sort()).toEqual(["hxsf", "png", "wav", "zip"]);
    for (const files of Object.values(manifest)) {
      expect(files.length).toBeGreaterThanOrEqual(5);
      const digests = new Set(files.map((file) => createHash("sha256").update(readFileSync(file.path)).digest("hex")));
      expect(digests.size).toBe(files.length);
    }
  });

  it("is deterministic", () => {
    const first = mkdtempSync(join(tmpdir(), "hexsleuth-a-"));
    const second = mkdtempSync(join(tmpdir(), "hexsleuth-b-"));
    scratchDirectories.push(first, second);
    const firstManifest = generateFixtures(first, first);
    const secondManifest = generateFixtures(second, second);
    expect(firstManifest).toEqual(secondManifest);
    for (const [format, files] of Object.entries(firstManifest)) {
      for (const file of files) {
        expect(readFileSync(join(first, file.path)), `${format} ${file.path}`).toEqual(readFileSync(join(second, file.path)));
      }
    }
  });
});

describe("PNG fixtures", () => {
  it("contain valid chunks with correct checksums ending in IEND", () => {
    for (const path of fixturePaths("png")) {
      const bytes = readFixture(path);
      expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const types: string[] = [];
      let position = 8;
      while (position < bytes.length) {
        const length = view(bytes).getUint32(position, false);
        const typeAndData = bytes.subarray(position + 4, position + 8 + length);
        expect(view(bytes).getUint32(position + 8 + length, false)).toBe(crc32(typeAndData));
        types.push(ascii(bytes, position + 4, 4));
        position += 12 + length;
      }
      expect(position).toBe(bytes.length);
      expect(types[0]).toBe("IHDR");
      expect(types.at(-1)).toBe("IEND");
    }
  });
});

describe("ZIP fixtures", () => {
  it("have a central directory that matches the local headers", () => {
    for (const path of fixturePaths("zip")) {
      const bytes = readFixture(path);
      const data = view(bytes);
      const endRecord = bytes.length - 22;
      expect(data.getUint32(endRecord, true)).toBe(0x06054b50);
      const entryCount = data.getUint16(endRecord + 10, true);
      let central = data.getUint32(endRecord + 16, true);
      for (let entry = 0; entry < entryCount; entry += 1) {
        expect(data.getUint32(central, true)).toBe(0x02014b50);
        const method = data.getUint16(central + 10, true);
        const checksum = data.getUint32(central + 16, true);
        const storedSize = data.getUint32(central + 20, true);
        const nameLength = data.getUint16(central + 28, true);
        const local = data.getUint32(central + 42, true);
        expect(data.getUint32(local, true)).toBe(0x04034b50);
        const bodyStart = local + 30 + data.getUint16(local + 26, true);
        const stored = bytes.subarray(bodyStart, bodyStart + storedSize);
        const content = method === 8 ? new Uint8Array(inflateRawSync(stored)) : stored;
        expect(crc32(content)).toBe(checksum);
        central += 46 + nameLength;
      }
      expect(central).toBe(endRecord);
    }
  });
});

describe("WAV fixtures", () => {
  it("declare a RIFF size of file size minus eight and walk to the end", () => {
    for (const path of fixturePaths("wav")) {
      const bytes = readFixture(path);
      expect(ascii(bytes, 0, 4)).toBe("RIFF");
      expect(view(bytes).getUint32(4, true)).toBe(bytes.length - 8);
      expect(ascii(bytes, 8, 4)).toBe("WAVE");
      let position = 12;
      const ids: string[] = [];
      while (position < bytes.length) {
        const length = view(bytes).getUint32(position + 4, true);
        ids.push(ascii(bytes, position, 4));
        position += 8 + length + (length % 2);
      }
      expect(position).toBe(bytes.length);
      expect(ids[0]).toBe("fmt ");
      expect(ids.at(-1)).toBe("data");
    }
  });
});

describe("HXSF fixtures", () => {
  it("have a consistent header, offset table, string pool and data area", () => {
    for (const path of fixturePaths("hxsf")) {
      const bytes = readFixture(path);
      const data = view(bytes);
      expect(ascii(bytes, 0, 4)).toBe("HXSF");
      expect(data.getUint32(8, true)).toBe(bytes.length);
      const entryCount = data.getUint32(12, true);
      const tableOffset = data.getUint32(16, true);
      const poolOffset = data.getUint32(20, true);
      const poolSize = data.getUint32(24, true);
      expect(poolOffset).toBe(tableOffset + 20 * entryCount);
      expect(data.getUint32(28, true)).toBe(poolOffset + poolSize);
      let expectedDataOffset = poolOffset + poolSize;
      for (let entry = 0; entry < entryCount; entry += 1) {
        const record = tableOffset + entry * 20;
        const nameOffset = data.getUint32(record, true);
        const codec = data.getUint16(record + 6, true);
        const dataOffset = data.getUint32(record + 8, true);
        const storedSize = data.getUint32(record + 12, true);
        const rawSize = data.getUint32(record + 16, true);
        expect(nameOffset).toBeLessThan(poolSize);
        expect(dataOffset).toBe(expectedDataOffset);
        const stored = bytes.subarray(dataOffset, dataOffset + storedSize);
        const content = codec === 1 ? inflateSync(stored) : stored;
        expect(content.length).toBe(rawSize);
        expectedDataOffset += storedSize;
      }
      expect(expectedDataOffset).toBe(bytes.length);
    }
  });
});
