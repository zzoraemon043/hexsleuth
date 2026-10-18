export class ByteRanges {
  private readonly ranges: [number, number][] = [];

  add(start: number, end: number): void {
    if (end > start) {
      this.ranges.push([start, end]);
    }
  }

  merged(): [number, number][] {
    const sorted = [...this.ranges].sort((left, right) => left[0] - right[0]);
    const output: [number, number][] = [];
    for (const [start, end] of sorted) {
      const last = output.at(-1);
      if (last && start <= last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        output.push([start, end]);
      }
    }
    return output;
  }

  gaps(size: number): { offset: number; length: number }[] {
    const gaps: { offset: number; length: number }[] = [];
    let cursor = 0;
    for (const [start, end] of this.merged()) {
      if (start > cursor) {
        gaps.push({ offset: cursor, length: start - cursor });
      }
      cursor = Math.max(cursor, end);
    }
    if (cursor < size) {
      gaps.push({ offset: cursor, length: size - cursor });
    }
    return gaps;
  }
}

export class ParseError extends Error {
  constructor(
    readonly path: string,
    readonly offset: number | null,
    message: string,
  ) {
    super(message);
  }
}

export class Stream {
  pos = 0;

  constructor(
    readonly bytes: Uint8Array,
    readonly base: number | null,
    private readonly coverage: ByteRanges | null,
  ) {}

  get size(): number {
    return this.bytes.length;
  }

  get isEof(): boolean {
    return this.pos >= this.bytes.length;
  }

  absolute(position = this.pos): number | null {
    return this.base === null ? null : this.base + position;
  }

  read(length: number, path: string): Uint8Array {
    if (length < 0) {
      throw new ParseError(path, this.absolute(), `negative size ${length}`);
    }
    if (this.pos + length > this.bytes.length) {
      throw new ParseError(path, this.absolute(), `needs ${length} bytes but only ${this.bytes.length - this.pos} remain`);
    }
    const slice = this.bytes.subarray(this.pos, this.pos + length);
    this.markRead(this.pos, this.pos + length);
    this.pos += length;
    return slice;
  }

  readUntilZero(path: string): Uint8Array {
    const end = this.bytes.indexOf(0, this.pos);
    if (end < 0) {
      throw new ParseError(path, this.absolute(), "no zero terminator before the end of the stream");
    }
    const slice = this.bytes.subarray(this.pos, end);
    this.markRead(this.pos, end + 1);
    this.pos = end + 1;
    return slice;
  }

  substream(length: number, path: string): Stream {
    if (length < 0 || this.pos + length > this.bytes.length) {
      throw new ParseError(path, this.absolute(), `needs ${length} bytes but only ${this.bytes.length - this.pos} remain`);
    }
    const start = this.pos;
    this.pos += length;
    return new Stream(this.bytes.subarray(start, start + length), this.base === null ? null : this.base + start, this.coverage);
  }

  seek(position: number, path: string): void {
    if (position < 0 || position > this.bytes.length) {
      throw new ParseError(path, this.absolute(0), `position ${position} is outside the stream of ${this.bytes.length} bytes`);
    }
    this.pos = position;
  }

  private markRead(start: number, end: number): void {
    if (this.coverage && this.base !== null) {
      this.coverage.add(this.base + start, this.base + end);
    }
  }
}
