import { crc32, deflateSync } from "node:zlib";
import { ByteWriter } from "./byte-writer.js";
import { randomInt, type RandomSource } from "./random.js";

export interface PngOptions {
  width: number;
  height: number;
  colorType: 0 | 2 | 6;
  text?: { keyword: string; value: string };
  idatParts: number;
}

const pngSignature = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const channelsByColorType = { 0: 1, 2: 3, 6: 4 } as const;

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const checksumInput = new Uint8Array(typeBytes.length + data.length);
  checksumInput.set(typeBytes);
  checksumInput.set(data, typeBytes.length);
  return new ByteWriter().u32be(data.length).bytes(checksumInput).u32be(crc32(checksumInput)).toBytes();
}

function headerData(options: PngOptions): Uint8Array {
  return new ByteWriter()
    .u32be(options.width)
    .u32be(options.height)
    .u8(8)
    .u8(options.colorType)
    .u8(0)
    .u8(0)
    .u8(0)
    .toBytes();
}

function scanlines(options: PngOptions, random: RandomSource): Uint8Array {
  const channels = channelsByColorType[options.colorType];
  const rowLength = 1 + options.width * channels;
  const pixels = new Uint8Array(rowLength * options.height);
  const shade = randomInt(random, 0, 255);
  for (let row = 0; row < options.height; row += 1) {
    for (let column = 0; column < options.width * channels; column += 1) {
      pixels[row * rowLength + 1 + column] = (shade + row * 7 + column * 3) & 0xff;
    }
  }
  return pixels;
}

function splitEvenly(data: Uint8Array, parts: number): Uint8Array[] {
  const partSize = Math.ceil(data.length / parts);
  const output: Uint8Array[] = [];
  for (let start = 0; start < data.length; start += partSize) {
    output.push(data.subarray(start, start + partSize));
  }
  return output;
}

export function buildPng(options: PngOptions, random: RandomSource): Uint8Array {
  const writer = new ByteWriter().bytes(pngSignature).bytes(chunk("IHDR", headerData(options)));
  if (options.text) {
    writer.bytes(chunk("tEXt", new TextEncoder().encode(`${options.text.keyword}\0${options.text.value}`)));
  }
  const compressed = new Uint8Array(deflateSync(scanlines(options, random)));
  for (const part of splitEvenly(compressed, options.idatParts)) {
    writer.bytes(chunk("IDAT", part));
  }
  return writer.bytes(chunk("IEND", new Uint8Array(0))).toBytes();
}

export const pngSamples: PngOptions[] = [
  { width: 1, height: 1, colorType: 0, idatParts: 1 },
  { width: 8, height: 4, colorType: 2, idatParts: 1, text: { keyword: "Title", value: "hexsleuth fixture" } },
  { width: 16, height: 16, colorType: 6, idatParts: 2 },
  { width: 5, height: 9, colorType: 0, idatParts: 1, text: { keyword: "Comment", value: "generated" } },
  { width: 32, height: 3, colorType: 2, idatParts: 3 },
  { width: 12, height: 12, colorType: 6, idatParts: 1, text: { keyword: "Author", value: "fixture script" } },
];
