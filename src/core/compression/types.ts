export const compressionMethods = ["zlib", "gzip", "deflate-raw", "lz4", "zstd"] as const;

export type CompressionMethod = (typeof compressionMethods)[number];

export interface DecodedStream {
  method: CompressionMethod;
  offset: number;
  compressedSize: number;
  output: Uint8Array;
  complete: boolean;
  evidence: string;
}

export const maxOutputLength = 64 * 1024 * 1024;
