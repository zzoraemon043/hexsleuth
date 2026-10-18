import { ByteWriter } from "./byte-writer.js";

export interface WavOptions {
  channels: 1 | 2;
  sampleRate: number;
  frames: number;
  title?: string;
  junkLength?: number;
}

function riffChunk(id: string, data: Uint8Array): Uint8Array {
  const writer = new ByteWriter().ascii(id).u32le(data.length).bytes(data);
  if (data.length % 2 === 1) {
    writer.u8(0);
  }
  return writer.toBytes();
}

function formatChunk(options: WavOptions): Uint8Array {
  const bytesPerSample = 2;
  const blockAlign = options.channels * bytesPerSample;
  return new ByteWriter()
    .u16le(1)
    .u16le(options.channels)
    .u32le(options.sampleRate)
    .u32le(options.sampleRate * blockAlign)
    .u16le(blockAlign)
    .u16le(16)
    .toBytes();
}

function sineSamples(options: WavOptions): Uint8Array {
  const writer = new ByteWriter();
  for (let frame = 0; frame < options.frames; frame += 1) {
    for (let channel = 0; channel < options.channels; channel += 1) {
      const amplitude = Math.round(Math.sin((frame * (channel + 1) * 2 * Math.PI) / 32) * 12000);
      writer.u16le(amplitude & 0xffff);
    }
  }
  return writer.toBytes();
}

function infoList(title: string): Uint8Array {
  const text = new TextEncoder().encode(`${title}\0`);
  return new ByteWriter().ascii("INFO").bytes(riffChunk("INAM", text)).toBytes();
}

export function buildWav(options: WavOptions): Uint8Array {
  const body = new ByteWriter().ascii("WAVE").bytes(riffChunk("fmt ", formatChunk(options)));
  if (options.title !== undefined) {
    body.bytes(riffChunk("LIST", infoList(options.title)));
  }
  if (options.junkLength !== undefined) {
    body.bytes(riffChunk("JUNK", new Uint8Array(options.junkLength)));
  }
  body.bytes(riffChunk("data", sineSamples(options)));
  const content = body.toBytes();
  return new ByteWriter().ascii("RIFF").u32le(content.length).bytes(content).toBytes();
}

export const wavSamples: WavOptions[] = [
  { channels: 1, sampleRate: 8000, frames: 64 },
  { channels: 2, sampleRate: 22050, frames: 100, title: "tone" },
  { channels: 1, sampleRate: 44100, frames: 257, junkLength: 3 },
  { channels: 2, sampleRate: 11025, frames: 31, title: "second fixture" },
  { channels: 1, sampleRate: 16000, frames: 500 },
  { channels: 2, sampleRate: 48000, frames: 12, title: "short", junkLength: 6 },
];
