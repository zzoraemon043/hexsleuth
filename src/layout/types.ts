export interface ScalarKind {
  kind: "integer" | "float";
  signed: boolean;
  width: 1 | 2 | 4 | 8;
  endian: "le" | "be" | null;
}

const scalarPattern = /^(u|s|f)(1|2|4|8)(le|be)?$/;

export function parseScalarType(type: string): ScalarKind | undefined {
  const match = scalarPattern.exec(type);
  if (!match) {
    return undefined;
  }
  const [, family, widthText, endian] = match;
  const width = Number(widthText) as 1 | 2 | 4 | 8;
  if (family === "f" && width !== 4 && width !== 8) {
    return undefined;
  }
  return {
    kind: family === "f" ? "float" : "integer",
    signed: family !== "u",
    width,
    endian: endian === "le" || endian === "be" ? endian : null,
  };
}

export function isBuiltinType(type: string): boolean {
  return type === "bytes" || type === "str" || type === "strz" || parseScalarType(type) !== undefined;
}

export function contentsBytes(contents: number[] | string): Uint8Array {
  return typeof contents === "string" ? Uint8Array.from(contents, (character) => character.charCodeAt(0) & 0xff) : Uint8Array.from(contents);
}

export function textDecoderLabel(encoding: string): string {
  const normalized = encoding.toLowerCase();
  return normalized === "ascii" ? "latin1" : normalized;
}
