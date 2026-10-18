export const scalarTypes = [
  "u1", "s1",
  "u2le", "u2be", "s2le", "s2be",
  "u4le", "u4be", "s4le", "s4be",
  "u8le", "u8be", "s8le", "s8be",
  "f4le", "f4be", "f8le", "f8be",
] as const;

export type ScalarType = (typeof scalarTypes)[number];

export type ScalarValue = number | string;

export function scalarWidth(type: ScalarType): number {
  const digit = Number(type.charAt(1));
  return digit;
}

export function isLittleEndian(type: ScalarType): boolean {
  return !type.endsWith("be");
}

function bigintToValue(value: bigint): ScalarValue {
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

export function readScalar(bytes: Uint8Array, offset: number, type: ScalarType): ScalarValue {
  const width = scalarWidth(type);
  if (offset < 0 || offset + width > bytes.length) {
    throw new RangeError(`${type} at ${offset} needs ${width} bytes, ${Math.max(0, bytes.length - offset)} available`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, width);
  const little = isLittleEndian(type);
  switch (type.slice(0, 2)) {
    case "u1": return view.getUint8(0);
    case "s1": return view.getInt8(0);
    case "u2": return view.getUint16(0, little);
    case "s2": return view.getInt16(0, little);
    case "u4": return view.getUint32(0, little);
    case "s4": return view.getInt32(0, little);
    case "u8": return bigintToValue(view.getBigUint64(0, little));
    case "s8": return bigintToValue(view.getBigInt64(0, little));
    case "f4": return view.getFloat32(0, little);
    default: return view.getFloat64(0, little);
  }
}

export function readUnsigned(bytes: Uint8Array, offset: number, width: 1 | 2 | 4, littleEndian: boolean): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, width);
  if (width === 1) {
    return view.getUint8(0);
  }
  return width === 2 ? view.getUint16(0, littleEndian) : view.getUint32(0, littleEndian);
}
