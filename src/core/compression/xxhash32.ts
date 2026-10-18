const prime1 = 0x9e3779b1;
const prime2 = 0x85ebca77;
const prime3 = 0xc2b2ae3d;
const prime4 = 0x27d4eb2f;
const prime5 = 0x165667b1;

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function readLane(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16) | ((bytes[offset + 3] ?? 0) << 24)) >>> 0;
}

function round(accumulator: number, lane: number): number {
  return Math.imul(rotateLeft((accumulator + Math.imul(lane, prime2)) >>> 0, 13), prime1) >>> 0;
}

export function xxhash32(bytes: Uint8Array, seed = 0): number {
  let position = 0;
  let hash: number;
  if (bytes.length >= 16) {
    const lanes = [(seed + prime1 + prime2) >>> 0, (seed + prime2) >>> 0, seed >>> 0, (seed - prime1) >>> 0];
    while (position + 16 <= bytes.length) {
      for (let lane = 0; lane < 4; lane += 1) {
        lanes[lane] = round(lanes[lane] ?? 0, readLane(bytes, position + lane * 4));
      }
      position += 16;
    }
    const [first = 0, second = 0, third = 0, fourth = 0] = lanes;
    hash = (rotateLeft(first, 1) + rotateLeft(second, 7) + rotateLeft(third, 12) + rotateLeft(fourth, 18)) >>> 0;
  } else {
    hash = (seed + prime5) >>> 0;
  }
  hash = (hash + bytes.length) >>> 0;
  while (position + 4 <= bytes.length) {
    hash = Math.imul(rotateLeft((hash + Math.imul(readLane(bytes, position), prime3)) >>> 0, 17), prime4) >>> 0;
    position += 4;
  }
  while (position < bytes.length) {
    hash = Math.imul(rotateLeft((hash + Math.imul(bytes[position] ?? 0, prime5)) >>> 0, 11), prime1) >>> 0;
    position += 1;
  }
  hash = Math.imul(hash ^ (hash >>> 15), prime2) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), prime3) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}
