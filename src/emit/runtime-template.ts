export const parserRuntime = `export class ParseError extends Error {}

export class ByteStream {
  pos = 0;

  constructor(readonly bytes: Uint8Array) {}

  get size(): number {
    return this.bytes.length;
  }

  get eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  seek(position: number): void {
    if (position < 0 || position > this.bytes.length) {
      throw new ParseError(\`position \${position} is outside the stream of \${this.bytes.length} bytes\`);
    }
    this.pos = position;
  }

  readBytes(length: number): Uint8Array {
    if (length < 0 || this.pos + length > this.bytes.length) {
      throw new ParseError(\`needs \${length} bytes at \${this.pos} but only \${this.bytes.length - this.pos} remain\`);
    }
    const slice = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  readBytesFull(): Uint8Array {
    return this.readBytes(this.bytes.length - this.pos);
  }

  readBytesTerminatedByZero(): Uint8Array {
    const end = this.bytes.indexOf(0, this.pos);
    if (end < 0) {
      throw new ParseError(\`no zero terminator after \${this.pos}\`);
    }
    const slice = this.bytes.subarray(this.pos, end);
    this.pos = end + 1;
    return slice;
  }

  substream(length: number): ByteStream {
    return new ByteStream(this.readBytes(length));
  }

  readUnsigned(width: 1 | 2 | 4 | 8, littleEndian: boolean): number {
    const view = this.view(width);
    switch (width) {
      case 1: return view.getUint8(0);
      case 2: return view.getUint16(0, littleEndian);
      case 4: return view.getUint32(0, littleEndian);
      default: return Number(view.getBigUint64(0, littleEndian));
    }
  }

  readSigned(width: 1 | 2 | 4 | 8, littleEndian: boolean): number {
    const view = this.view(width);
    switch (width) {
      case 1: return view.getInt8(0);
      case 2: return view.getInt16(0, littleEndian);
      case 4: return view.getInt32(0, littleEndian);
      default: return Number(view.getBigInt64(0, littleEndian));
    }
  }

  readFloat(width: 4 | 8, littleEndian: boolean): number {
    const view = this.view(width);
    return width === 4 ? view.getFloat32(0, littleEndian) : view.getFloat64(0, littleEndian);
  }

  expectContents(expected: number[], name: string): Uint8Array {
    const actual = this.readBytes(expected.length);
    if (!expected.every((byte, index) => actual[index] === byte)) {
      throw new ParseError(\`\${name} does not match the expected contents\`);
    }
    return actual;
  }

  private view(width: number): DataView {
    const bytes = this.readBytes(width);
    return new DataView(bytes.buffer, bytes.byteOffset, width);
  }
}
`;

export const runtimeHelpers = {
  decode: `function decode(bytes: Uint8Array, encoding: string): string {
  const label = encoding.toLowerCase() === "ascii" ? "latin1" : encoding.toLowerCase();
  return new TextDecoder(label).decode(bytes);
}
`,
  inflate: `function inflate(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(inflateSync(bytes));
}
`,
  mod: `function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
`,
} as const;

export const inflateImport = 'import { inflateSync } from "node:zlib";\n';
