import { isPrintableAscii } from "./hex.js";

export interface PrintableString {
  offset: number;
  length: number;
  text: string;
}

const maxTextLength = 256;

export function findPrintableStrings(bytes: Uint8Array, baseOffset: number, minLength: number): PrintableString[] {
  const found: PrintableString[] = [];
  let runStart = -1;
  const closeRun = (end: number): void => {
    if (runStart >= 0 && end - runStart >= minLength) {
      const text = String.fromCharCode(...bytes.subarray(runStart, Math.min(end, runStart + maxTextLength)));
      found.push({ offset: baseOffset + runStart, length: end - runStart, text });
    }
    runStart = -1;
  };
  for (let index = 0; index < bytes.length; index += 1) {
    if (isPrintableAscii(bytes[index] ?? 0)) {
      if (runStart < 0) {
        runStart = index;
      }
    } else {
      closeRun(index);
    }
  }
  closeRun(bytes.length);
  return found;
}
