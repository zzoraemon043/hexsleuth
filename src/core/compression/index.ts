import { decodeDeflateRaw, decodeGzip, decodeZlib, isZlibHeader } from "./deflate.js";
import { decodeLz4, hasLz4Magic } from "./lz4.js";
import type { CompressionMethod, DecodedStream } from "./types.js";
import { decodeZstd, hasZstdMagic } from "./zstd.js";

export { compressionMethods, type CompressionMethod, type DecodedStream } from "./types.js";

const decoders: Record<CompressionMethod, (bytes: Uint8Array, offset: number) => DecodedStream | undefined> = {
  zlib: decodeZlib,
  gzip: decodeGzip,
  "deflate-raw": decodeDeflateRaw,
  lz4: decodeLz4,
  zstd: decodeZstd,
};

export const signatureMethods: CompressionMethod[] = ["zlib", "gzip", "lz4", "zstd"];

export function tryDecode(bytes: Uint8Array, offset: number, method: CompressionMethod): DecodedStream | undefined {
  try {
    return decoders[method](bytes, offset);
  } catch {
    return undefined;
  }
}

export function signatureAt(bytes: Uint8Array, offset: number): CompressionMethod | undefined {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  if (first === undefined || second === undefined) {
    return undefined;
  }
  if (first === 0x1f && second === 0x8b) {
    return "gzip";
  }
  if (hasLz4Magic(bytes, offset)) {
    return "lz4";
  }
  if (hasZstdMagic(bytes, offset)) {
    return "zstd";
  }
  return isZlibHeader(first, second) ? "zlib" : undefined;
}

export function findStreamsInWindow(bytes: Uint8Array, start: number, end: number): DecodedStream[] {
  const found: DecodedStream[] = [];
  let offset = Math.max(0, start);
  while (offset < Math.min(end, bytes.length - 1)) {
    const method = signatureAt(bytes, offset);
    const decoded = method ? tryDecode(bytes, offset, method) : undefined;
    if (decoded) {
      found.push(decoded);
      offset += Math.max(1, decoded.compressedSize);
      continue;
    }
    offset += 1;
  }
  return found;
}
