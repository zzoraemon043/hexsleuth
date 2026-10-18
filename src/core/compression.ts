import { constants, crc32, inflateRawSync, inflateSync } from "node:zlib";

export const compressionMethods = ["zlib", "gzip", "deflate-raw"] as const;

export type CompressionMethod = (typeof compressionMethods)[number];

export interface DecodedStream {
  method: CompressionMethod;
  offset: number;
  compressedSize: number;
  output: Uint8Array;
  complete: boolean;
  evidence: string;
}

interface InflateResult {
  buffer: Buffer;
  engine: { bytesWritten: number };
}

const maxOutputLength = 64 * 1024 * 1024;

function inflateWithInfo(input: Uint8Array, raw: boolean): InflateResult {
  const options = { info: true, maxOutputLength } as const;
  const result: unknown = raw ? inflateRawSync(input, options) : inflateSync(input, options);
  return result as InflateResult;
}

function isZlibHeader(first: number, second: number): boolean {
  return (first & 0x0f) === 8 && first >> 4 <= 7 && ((first << 8) | second) % 31 === 0;
}

function inflatesAsPrefix(input: Uint8Array): Buffer | undefined {
  try {
    return inflateSync(input, { finishFlush: constants.Z_SYNC_FLUSH, maxOutputLength });
  } catch {
    return undefined;
  }
}

const minimumInterruptedLength = 16;

function longestValidZlibPrefix(bytes: Uint8Array, offset: number): DecodedStream | undefined {
  let valid = 2;
  let invalid = bytes.length - offset + 1;
  while (invalid - valid > 1) {
    const middle = Math.floor((valid + invalid) / 2);
    if (inflatesAsPrefix(bytes.subarray(offset, offset + middle))) {
      valid = middle;
    } else {
      invalid = middle;
    }
  }
  const output = inflatesAsPrefix(bytes.subarray(offset, offset + valid));
  if (!output || valid < minimumInterruptedLength || output.length < minimumInterruptedLength) {
    return undefined;
  }
  return {
    method: "zlib",
    offset,
    compressedSize: valid,
    output: new Uint8Array(output),
    complete: false,
    evidence: `zlib header passes the FCHECK test and the first ${valid} bytes inflate cleanly, then the data stops being a valid continuation; the stream is interrupted or truncated, for example split across chunks`,
  };
}

function decodeZlib(bytes: Uint8Array, offset: number): DecodedStream | undefined {
  const [first, second] = [bytes[offset], bytes[offset + 1]];
  if (first === undefined || second === undefined || !isZlibHeader(first, second)) {
    return undefined;
  }
  try {
    const result = inflateWithInfo(bytes.subarray(offset), false);
    return {
      method: "zlib",
      offset,
      compressedSize: result.engine.bytesWritten,
      output: new Uint8Array(result.buffer),
      complete: true,
      evidence: `zlib header ${first.toString(16)} ${second.toString(16)} passes the FCHECK test and the stream inflates with a valid Adler-32 trailer`,
    };
  } catch {
    return longestValidZlibPrefix(bytes, offset);
  }
}

function gzipHeaderLength(bytes: Uint8Array, offset: number): number | undefined {
  if (bytes[offset] !== 0x1f || bytes[offset + 1] !== 0x8b || bytes[offset + 2] !== 0x08) {
    return undefined;
  }
  const flags = bytes[offset + 3] ?? 0;
  let position = offset + 10;
  if (flags & 0x04) {
    position += 2 + ((bytes[position] ?? 0) | ((bytes[position + 1] ?? 0) << 8));
  }
  for (const flag of [0x08, 0x10]) {
    if (flags & flag) {
      while (position < bytes.length && bytes[position] !== 0) {
        position += 1;
      }
      position += 1;
    }
  }
  if (flags & 0x02) {
    position += 2;
  }
  return position <= bytes.length ? position - offset : undefined;
}

function decodeGzip(bytes: Uint8Array, offset: number): DecodedStream | undefined {
  const headerLength = gzipHeaderLength(bytes, offset);
  if (headerLength === undefined) {
    return undefined;
  }
  const bodyStart = offset + headerLength;
  const result = inflateWithInfo(bytes.subarray(bodyStart), true);
  const trailerStart = bodyStart + result.engine.bytesWritten;
  if (trailerStart + 8 > bytes.length) {
    throw new Error("gzip trailer is truncated");
  }
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + trailerStart, 8);
  const output = new Uint8Array(result.buffer);
  if (trailer.getUint32(0, true) !== crc32(output) || trailer.getUint32(4, true) !== output.length % 2 ** 32) {
    throw new Error("gzip trailer CRC-32 or size does not match the inflated data");
  }
  return {
    method: "gzip",
    offset,
    compressedSize: trailerStart + 8 - offset,
    output,
    complete: true,
    evidence: "gzip header 1f 8b 08, deflate body inflates and the trailer CRC-32 and size match",
  };
}

function decodeDeflateRaw(bytes: Uint8Array, offset: number): DecodedStream | undefined {
  const result = inflateWithInfo(bytes.subarray(offset), true);
  if (result.buffer.length === 0) {
    return undefined;
  }
  return {
    method: "deflate-raw",
    offset,
    compressedSize: result.engine.bytesWritten,
    output: new Uint8Array(result.buffer),
    complete: true,
    evidence: "raw deflate data inflates to the final block; raw deflate has no header or checksum, so this is weaker evidence",
  };
}

const decoders: Record<CompressionMethod, (bytes: Uint8Array, offset: number) => DecodedStream | undefined> = {
  zlib: decodeZlib,
  gzip: decodeGzip,
  "deflate-raw": decodeDeflateRaw,
};

export function tryDecode(bytes: Uint8Array, offset: number, method: CompressionMethod): DecodedStream | undefined {
  try {
    return decoders[method](bytes, offset);
  } catch {
    return undefined;
  }
}

export const signatureMethods: CompressionMethod[] = ["zlib", "gzip"];

export function hasSignature(bytes: Uint8Array, offset: number): boolean {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  if (first === undefined || second === undefined) {
    return false;
  }
  return isZlibHeader(first, second) || (first === 0x1f && second === 0x8b);
}

export function findStreamsInWindow(bytes: Uint8Array, start: number, end: number): DecodedStream[] {
  const found: DecodedStream[] = [];
  let offset = Math.max(0, start);
  while (offset < Math.min(end, bytes.length - 1)) {
    if (hasSignature(bytes, offset)) {
      const decoded = signatureMethods.map((method) => tryDecode(bytes, offset, method)).find((stream) => stream !== undefined);
      if (decoded) {
        found.push(decoded);
        offset += Math.max(1, decoded.compressedSize);
        continue;
      }
    }
    offset += 1;
  }
  return found;
}
