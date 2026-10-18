export class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  get size(): number {
    return this.length;
  }

  bytes(data: Uint8Array): this {
    this.chunks.push(data);
    this.length += data.length;
    return this;
  }

  ascii(text: string): this {
    return this.bytes(new TextEncoder().encode(text));
  }

  u8(value: number): this {
    return this.bytes(Uint8Array.of(value & 0xff));
  }

  u16le(value: number): this {
    return this.fixed(2, (view) => view.setUint16(0, value, true));
  }

  u16be(value: number): this {
    return this.fixed(2, (view) => view.setUint16(0, value, false));
  }

  u32le(value: number): this {
    return this.fixed(4, (view) => view.setUint32(0, value >>> 0, true));
  }

  u32be(value: number): this {
    return this.fixed(4, (view) => view.setUint32(0, value >>> 0, false));
  }

  toBytes(): Uint8Array {
    const output = new Uint8Array(this.length);
    let position = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, position);
      position += chunk.length;
    }
    return output;
  }

  private fixed(width: number, write: (view: DataView) => void): this {
    const buffer = new Uint8Array(width);
    write(new DataView(buffer.buffer));
    return this.bytes(buffer);
  }
}
