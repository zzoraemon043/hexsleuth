export function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) {
    return 0;
  }
  const counts = new Uint32Array(256);
  for (const byte of bytes) {
    counts[byte] = (counts[byte] ?? 0) + 1;
  }
  let entropy = 0;
  for (const count of counts) {
    if (count > 0) {
      const probability = count / bytes.length;
      entropy -= probability * Math.log2(probability);
    }
  }
  return entropy;
}

export function highEntropyThreshold(blockLength: number): number {
  return 0.85 * Math.log2(Math.min(256, Math.max(2, blockLength)));
}

export function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
