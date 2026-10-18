declare module "lz4js" {
  export function compress(source: Uint8Array, maxSize?: number): Uint8Array;
  export function decompress(source: Uint8Array, maxSize?: number): Uint8Array;
}
