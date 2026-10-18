export type RandomSource = () => number;

export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(random: RandomSource, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

export function randomBytes(random: RandomSource, length: number): Uint8Array {
  const output = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = Math.floor(random() * 256);
  }
  return output;
}

const words = [
  "format", "chunk", "offset", "table", "string", "pool", "header", "sample", "length", "count",
  "version", "entry", "field", "record", "stream", "block", "index", "value", "layout", "evidence",
];

export function randomText(random: RandomSource, minLength: number): string {
  const parts: string[] = [];
  let length = 0;
  while (length < minLength) {
    const word = words[randomInt(random, 0, words.length - 1)] ?? "byte";
    parts.push(word);
    length += word.length + 1;
  }
  return `${parts.join(" ")}.\n`;
}
