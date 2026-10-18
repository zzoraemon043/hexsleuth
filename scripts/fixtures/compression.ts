import * as zlib from "node:zlib";
import { compress as lz4Compress } from "lz4js";
import { ByteWriter } from "./byte-writer.js";
import { randomBytes, randomText, seededRandom } from "./random.js";

export interface CompressionFixture {
  name: string;
  bytes: Uint8Array;
  facts: Record<string, string | number>;
}

const headerText = "HXCMP container header\0";
const trailerText = "\0end of container";

function rawBlockZstdFrame(content: Uint8Array): Uint8Array {
  const singleSegmentWithFourByteSize = 0xa0;
  const writer = new ByteWriter().u32le(0xfd2fb528).u8(singleSegmentWithFourByteSize).u32le(content.length);
  const lastRawBlockHeader = (content.length << 3) | 1;
  return writer.u8(lastRawBlockHeader & 0xff).u8((lastRawBlockHeader >> 8) & 0xff).u8((lastRawBlockHeader >> 16) & 0xff).bytes(content).toBytes();
}

function zstdCompress(content: Uint8Array): Uint8Array {
  const builtIn = (zlib as unknown as { zstdCompressSync?: (input: Uint8Array) => Buffer }).zstdCompressSync;
  return builtIn ? new Uint8Array(builtIn(content)) : rawBlockZstdFrame(content);
}

function embedded(name: string, method: string, stream: Uint8Array, decompressedSize: number): CompressionFixture {
  const prefix = new TextEncoder().encode(headerText);
  const bytes = new ByteWriter().bytes(prefix).bytes(stream).ascii(trailerText).toBytes();
  return { name, bytes, facts: { method, offset: prefix.length, compressedSize: stream.length, decompressedSize } };
}

export function compressionFixtures(): CompressionFixture[] {
  const random = seededRandom(97);
  const content = new TextEncoder().encode(randomText(random, 3000));
  return [
    embedded("zlib.bin", "zlib", new Uint8Array(zlib.deflateSync(content)), content.length),
    embedded("gzip.bin", "gzip", new Uint8Array(zlib.gzipSync(content)), content.length),
    embedded("deflate-raw.bin", "deflate-raw", new Uint8Array(zlib.deflateRawSync(content)), content.length),
    embedded("lz4.bin", "lz4", lz4Compress(content), content.length),
    embedded("zstd.bin", "zstd", zstdCompress(content), content.length),
    embedded("zstd-raw-block.bin", "zstd", rawBlockZstdFrame(content.subarray(0, 512)), 512),
    { name: "random.bin", bytes: randomBytes(random, 4096), facts: { method: "none", offset: 0 } },
    { name: "plain.bin", bytes: content, facts: { method: "none", offset: 0 } },
  ];
}
