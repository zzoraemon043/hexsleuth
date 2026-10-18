import { toHex } from "./hex.js";

export interface MagicCandidate {
  offset: number;
  bytes: string;
  name: string;
  confidence: number;
}

interface Signature {
  name: string;
  bytes: number[];
  offset?: number;
  confidence: number;
}

const signatures: Signature[] = [
  { name: "PNG image", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], confidence: 0.99 },
  { name: "ZIP local file header", bytes: [0x50, 0x4b, 0x03, 0x04], confidence: 0.9 },
  { name: "ZIP end of central directory (empty archive)", bytes: [0x50, 0x4b, 0x05, 0x06], confidence: 0.9 },
  { name: "gzip stream", bytes: [0x1f, 0x8b, 0x08], confidence: 0.9 },
  { name: "Zstandard frame", bytes: [0x28, 0xb5, 0x2f, 0xfd], confidence: 0.95 },
  { name: "LZ4 frame", bytes: [0x04, 0x22, 0x4d, 0x18], confidence: 0.95 },
  { name: "RIFF container", bytes: [0x52, 0x49, 0x46, 0x46], confidence: 0.8 },
  { name: "WAVE audio in RIFF", bytes: [0x57, 0x41, 0x56, 0x45], offset: 8, confidence: 0.95 },
  { name: "glTF binary", bytes: [0x67, 0x6c, 0x54, 0x46], confidence: 0.9 },
  { name: "PDF document", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], confidence: 0.95 },
  { name: "GIF image", bytes: [0x47, 0x49, 0x46, 0x38], confidence: 0.9 },
  { name: "JPEG image", bytes: [0xff, 0xd8, 0xff], confidence: 0.85 },
  { name: "Ogg container", bytes: [0x4f, 0x67, 0x67, 0x53], confidence: 0.9 },
  { name: "FLAC audio", bytes: [0x66, 0x4c, 0x61, 0x43], confidence: 0.9 },
  { name: "ELF object", bytes: [0x7f, 0x45, 0x4c, 0x46], confidence: 0.95 },
  { name: "SQLite database", bytes: Array.from("SQLite format 3\0", (character) => character.charCodeAt(0)), confidence: 0.99 },
  { name: "xz stream", bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], confidence: 0.95 },
  { name: "bzip2 stream", bytes: [0x42, 0x5a, 0x68], confidence: 0.6 },
  { name: "7z archive", bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], confidence: 0.95 },
];

function matchesAt(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function isZlibHeader(first: number, second: number): boolean {
  return (first & 0x0f) === 8 && first >> 4 <= 7 && ((first << 8) | second) % 31 === 0;
}

function printableTag(bytes: Uint8Array): string | undefined {
  const tag = bytes.subarray(0, 4);
  if (tag.length < 4 || !tag.every((byte) => (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a))) {
    return undefined;
  }
  return String.fromCharCode(...tag);
}

export function findMagic(bytes: Uint8Array, baseOffset: number): MagicCandidate[] {
  const candidates: MagicCandidate[] = [];
  for (const signature of signatures) {
    const offset = signature.offset ?? 0;
    if (matchesAt(bytes, offset, signature.bytes)) {
      const matched = bytes.subarray(offset, offset + signature.bytes.length);
      candidates.push({ offset: baseOffset + offset, bytes: toHex(matched), name: signature.name, confidence: signature.confidence });
    }
  }
  const [first, second] = [bytes[0], bytes[1]];
  if (first !== undefined && second !== undefined && isZlibHeader(first, second)) {
    candidates.push({ offset: baseOffset, bytes: toHex(bytes.subarray(0, 2)), name: "zlib stream header", confidence: 0.5 });
  }
  const tag = printableTag(bytes);
  if (tag !== undefined && candidates.length === 0) {
    candidates.push({ offset: baseOffset, bytes: toHex(bytes.subarray(0, 4)), name: `unknown printable tag "${tag}"`, confidence: 0.5 });
  }
  return candidates;
}
