export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

export function toAsciiPreview(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".")).join("");
}

export function formatOffset(offset: number): string {
  return `0x${offset.toString(16).padStart(4, "0")}`;
}

export function isPrintableAscii(byte: number): boolean {
  return (byte >= 0x20 && byte <= 0x7e) || byte === 0x09;
}
