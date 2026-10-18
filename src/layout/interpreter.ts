import { inflateSync } from "node:zlib";
import { toHex } from "../core/hex.js";
import { EvaluationError, evaluate, evaluateNumber } from "./evaluate.js";
import { instanceFields, rootType, type Layout, type NamedField, type TypeSpec } from "./schema.js";
import { ByteRanges, ParseError, Stream } from "./stream.js";
import { contentsBytes, parseScalarType, textDecoderLabel } from "./types.js";
import { ParsedObject, type TreeNode, type Value } from "./values.js";

export interface ParseOutcome {
  root: ParsedObject;
  error: ParseError | null;
  coverage: ByteRanges;
}

const previewLength = 32;
const absentInstance = Symbol("absent");

export class LayoutInterpreter {
  private readonly instanceState = new WeakMap<ParsedObject, Map<string, "computing" | typeof absentInstance>>();

  constructor(private readonly layout: Layout) {}

  parse(bytes: Uint8Array): ParseOutcome {
    const coverage = new ByteRanges();
    const stream = new Stream(bytes, 0, coverage);
    const node: TreeNode = { name: this.layout.id, type: this.layout.id, offset: 0, size: 0, fields: [] };
    const root = new ParsedObject(this.layout.id, null, null, stream, node);
    try {
      this.parseBody(root, rootType(this.layout), this.layout.id);
      node.size = stream.pos;
      return { root, error: null, coverage };
    } catch (error) {
      return { root, error: this.asParseError(error, this.layout.id, stream), coverage };
    }
  }

  private typeSpec(name: string): TypeSpec {
    if (name === this.layout.id) {
      return rootType(this.layout);
    }
    const spec = this.layout.types?.[name];
    if (!spec) {
      throw new EvaluationError(`unknown type ${name}`);
    }
    return spec;
  }

  private readonly resolveName = (object: ParsedObject, name: string): Value => {
    if (name === "_root") {
      return object.root;
    }
    if (name === "_parent") {
      if (!object.parent) {
        throw new EvaluationError("_parent is not available at the root");
      }
      return object.parent;
    }
    if (name === "_io") {
      return { kind: "io", stream: object.io };
    }
    const value = object.values.get(name);
    if (value !== undefined) {
      return value;
    }
    const instance = this.typeSpec(object.typeName).instances?.[name];
    if (instance) {
      const computed = this.computeInstance(object, { ...instance, id: name }, object.node.name);
      if (computed === undefined) {
        throw new EvaluationError(`instance ${name} is absent because its if condition is false`);
      }
      return computed;
    }
    throw new EvaluationError(`unknown name ${name} in ${object.typeName}`);
  };

  private parseBody(object: ParsedObject, spec: TypeSpec, path: string): void {
    for (const field of spec.seq) {
      this.readFieldInto(object, field, `${path}.${field.id}`);
    }
    for (const instance of instanceFields(spec.instances)) {
      if (!object.values.has(instance.id) && this.instanceStatus(object, instance.id) === undefined) {
        this.computeInstance(object, instance, `${path}.${instance.id}`);
      }
    }
  }

  private instanceStatus(object: ParsedObject, name: string): "computing" | typeof absentInstance | undefined {
    return this.instanceState.get(object)?.get(name);
  }

  private setInstanceStatus(object: ParsedObject, name: string, status: "computing" | typeof absentInstance | undefined): void {
    const states = this.instanceState.get(object) ?? new Map<string, "computing" | typeof absentInstance>();
    if (status === undefined) {
      states.delete(name);
    } else {
      states.set(name, status);
    }
    this.instanceState.set(object, states);
  }

  private computeInstance(object: ParsedObject, instance: NamedField, path: string): Value | undefined {
    const status = this.instanceStatus(object, instance.id);
    if (status === "computing") {
      throw new EvaluationError(`instance ${instance.id} depends on itself`);
    }
    if (status === absentInstance) {
      return undefined;
    }
    const condition = instance.if;
    if (condition !== undefined && !this.guard(() => evaluate(condition, object, this.resolveName), path, object.io)) {
      this.setInstanceStatus(object, instance.id, absentInstance);
      return undefined;
    }
    this.setInstanceStatus(object, instance.id, "computing");
    const saved = object.io.pos;
    try {
      object.io.seek(this.guard(() => evaluateNumber(instance.pos ?? 0, object, this.resolveName, "pos"), path, object.io), path);
      const value = this.readRepeated(object, instance, object.io, path, (node) => object.node.fields?.push(node));
      object.values.set(instance.id, value);
      return value;
    } finally {
      object.io.pos = saved;
      if (this.instanceStatus(object, instance.id) === "computing") {
        this.setInstanceStatus(object, instance.id, undefined);
      }
    }
  }

  private readFieldInto(object: ParsedObject, field: NamedField, path: string): void {
    const condition = field.if;
    if (condition !== undefined && !this.guard(() => evaluate(condition, object, this.resolveName), path, object.io)) {
      return;
    }
    const value = this.readRepeated(object, field, object.io, path, (node) => object.node.fields?.push(node));
    object.values.set(field.id, value);
  }

  private guard<T>(action: () => T, path: string, stream: Stream): T {
    try {
      return action();
    } catch (error) {
      throw this.asParseError(error, path, stream);
    }
  }

  private asParseError(error: unknown, path: string, stream: Stream): ParseError {
    if (error instanceof ParseError) {
      return error;
    }
    return new ParseError(path, stream.absolute(), (error as Error).message);
  }

  private readRepeated(object: ParsedObject, field: NamedField, stream: Stream, path: string, attach: (node: TreeNode) => void): Value {
    if (field.repeat === undefined) {
      return this.readOne(object, field, stream, path, attach);
    }
    const start = stream.pos;
    const node: TreeNode = { name: field.id, type: `${field.type}[]`, offset: stream.absolute(), size: 0, items: [] };
    attach(node);
    const values: Value[] = [];
    try {
      const count =
        field.repeat === "expr"
          ? this.guard(() => evaluateNumber(field.repeatExpr ?? 0, object, this.resolveName, "repeatExpr"), path, stream)
          : Number.POSITIVE_INFINITY;
      for (let index = 0; index < count && (field.repeat === "expr" || !stream.isEof); index += 1) {
        values.push(this.readOne(object, { ...field, id: `${field.id}[${index}]` }, stream, `${path}[${index}]`, (item) => node.items?.push(item)));
      }
    } finally {
      node.size = stream.pos - start;
    }
    return values;
  }

  private readOne(object: ParsedObject, field: NamedField, stream: Stream, path: string, attach: (node: TreeNode) => void): Value {
    const start = stream.pos;
    const node: TreeNode = { name: field.id, type: field.type, offset: stream.absolute(), size: 0 };
    attach(node);
    try {
      return this.guard(() => this.readValue(object, field, stream, path, node), path, stream);
    } finally {
      node.size = stream.pos - start;
    }
  }

  private sizeOf(object: ParsedObject, field: NamedField, stream: Stream): number | undefined {
    if (field.sizeEos) {
      return stream.size - stream.pos;
    }
    if (field.size !== undefined) {
      return evaluateNumber(field.size, object, this.resolveName, "size");
    }
    return field.contents === undefined ? undefined : contentsBytes(field.contents).length;
  }

  private readValue(object: ParsedObject, field: NamedField, stream: Stream, path: string, node: TreeNode): Value {
    const scalar = parseScalarType(field.type);
    if (scalar) {
      const value = this.readScalar(stream, scalar.width, scalar.kind, scalar.signed, (scalar.endian ?? field.endian ?? this.layout.endian) === "le", path);
      node.value = value;
      return value;
    }
    if (field.type === "strz") {
      const text = new TextDecoder(textDecoderLabel(field.encoding ?? "ascii")).decode(stream.readUntilZero(path));
      node.value = text;
      return text;
    }
    const size = this.sizeOf(object, field, stream);
    if (field.type === "bytes" || field.type === "str") {
      const raw = stream.read(size ?? 0, path);
      const bytes = field.process === "zlib" ? this.inflate(raw, path, stream) : raw;
      if (field.contents !== undefined) {
        this.checkContents(field.contents, bytes, path, stream.absolute(stream.pos - bytes.length));
      }
      if (field.type === "str") {
        const text = new TextDecoder(textDecoderLabel(field.encoding ?? "ascii")).decode(bytes);
        node.value = text;
        return text;
      }
      node.preview = `${toHex(bytes.subarray(0, previewLength))}${bytes.length > previewLength ? " ..." : ""}`;
      if (field.process === "zlib") {
        node.type = `bytes (zlib, ${bytes.length} bytes inflated)`;
      }
      return bytes;
    }
    return this.readUserType(object, field, stream, path, node, size);
  }

  private readUserType(object: ParsedObject, field: NamedField, stream: Stream, path: string, node: TreeNode, size: number | undefined): Value {
    let inner = stream;
    if (size !== undefined && field.process === "zlib") {
      inner = new Stream(this.inflate(stream.read(size, path), path, stream), null, null);
    } else if (size !== undefined) {
      inner = stream.substream(size, path);
    }
    node.fields = [];
    const child = new ParsedObject(field.type, object, object.root, inner, node);
    this.parseBody(child, this.typeSpec(field.type), path);
    return child;
  }

  private inflate(raw: Uint8Array, path: string, stream: Stream): Uint8Array {
    try {
      return new Uint8Array(inflateSync(raw));
    } catch (error) {
      throw new ParseError(path, stream.absolute(stream.pos - raw.length), `zlib inflate failed: ${(error as Error).message}`);
    }
  }

  private checkContents(contents: number[] | string, actual: Uint8Array, path: string, offset: number | null): void {
    const expected = contentsBytes(contents);
    const matches = expected.length === actual.length && expected.every((byte, index) => byte === actual[index]);
    if (!matches) {
      throw new ParseError(path, offset, `contents mismatch: expected ${toHex(expected)}, found ${toHex(actual)}`);
    }
  }

  private readScalar(stream: Stream, width: 1 | 2 | 4 | 8, kind: "integer" | "float", signed: boolean, littleEndian: boolean, path: string): number {
    const bytes = stream.read(width, path);
    const view = new DataView(bytes.buffer, bytes.byteOffset, width);
    if (kind === "float") {
      return width === 4 ? view.getFloat32(0, littleEndian) : view.getFloat64(0, littleEndian);
    }
    switch (width) {
      case 1: return signed ? view.getInt8(0) : view.getUint8(0);
      case 2: return signed ? view.getInt16(0, littleEndian) : view.getUint16(0, littleEndian);
      case 4: return signed ? view.getInt32(0, littleEndian) : view.getUint32(0, littleEndian);
      default: return Number(signed ? view.getBigInt64(0, littleEndian) : view.getBigUint64(0, littleEndian));
    }
  }
}
