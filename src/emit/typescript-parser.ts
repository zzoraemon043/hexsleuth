import { contentsBytes, parseScalarType } from "../layout/types.js";
import type { Layout, NamedField, TypeSpec } from "../layout/schema.js";
import { TypeScriptExpressions } from "./expression-ts.js";
import { EmitError, parseFunctionName, pascalCase, readFunctionName } from "./naming.js";
import { inflateImport, parserRuntime, runtimeHelpers } from "./runtime-template.js";
import { LayoutTypes, type StaticType } from "./static-types.js";
import { orderInstances } from "./instance-order.js";

function typeScriptType(type: StaticType): string {
  switch (type.kind) {
    case "int":
    case "float":
      return "number";
    case "bool":
      return "boolean";
    case "string":
      return "string";
    case "bytes":
      return "Uint8Array";
    case "io":
      return "ByteStream";
    case "user":
      return pascalCase(type.name);
    case "array":
      return `${typeScriptType(type.element)}[]`;
  }
}

class ParserWriter {
  private readonly types: LayoutTypes;
  private readonly expressions: TypeScriptExpressions;

  constructor(private readonly layout: Layout) {
    this.types = new LayoutTypes(layout);
    this.expressions = new TypeScriptExpressions(this.types);
  }

  write(): string {
    const body: string[] = [];
    for (const [name, spec] of this.types.allTypes()) {
      body.push(this.interfaceFor(name, spec));
    }
    for (const [name, spec] of this.types.allTypes()) {
      body.push(this.parseFunction(name, spec));
    }
    body.push(this.entryFunction());
    const code = body.join("\n");
    const helpers = Object.entries(runtimeHelpers)
      .filter(([name]) => code.includes(`${name}(`))
      .map(([, helper]) => helper);
    const header = code.includes("inflate(") ? `${inflateImport}\n` : "";
    return [`${header}${parserRuntime}`, ...helpers, code].join("\n");
  }

  private interfaceFor(name: string, spec: TypeSpec): string {
    const lines = this.types.fieldsOf(spec).map((field) => {
      const optional = field.if !== undefined ? "?" : "";
      return `  ${field.id}${optional}: ${typeScriptType(this.types.fieldType(field))};`;
    });
    return `export interface ${pascalCase(name)} {\n${lines.join("\n")}\n}\n`;
  }

  private littleEndian(field: NamedField): boolean {
    const scalar = parseScalarType(field.type);
    return (scalar?.endian ?? field.endian ?? this.layout.endian) === "le";
  }

  private expression(value: string | number, typeName: string): string {
    return this.expressions.translate(value, typeName);
  }

  private sizeCode(field: NamedField, typeName: string): string | undefined {
    if (field.size !== undefined) {
      return this.expression(field.size, typeName);
    }
    return undefined;
  }

  private rawBytesCode(field: NamedField, typeName: string): string {
    if (field.sizeEos) {
      return "io.readBytesFull()";
    }
    const size = this.sizeCode(field, typeName);
    if (size === undefined) {
      throw new EmitError(`${typeName}.${field.id} needs a size`);
    }
    return `io.readBytes(${size})`;
  }

  private itemCode(field: NamedField, typeName: string): string {
    const scalar = parseScalarType(field.type);
    if (scalar) {
      const little = this.littleEndian(field);
      if (scalar.kind === "float") {
        return `io.readFloat(${scalar.width}, ${little})`;
      }
      return `io.${scalar.signed ? "readSigned" : "readUnsigned"}(${scalar.width}, ${little})`;
    }
    if (field.type === "strz") {
      return `decode(io.readBytesTerminatedByZero(), ${JSON.stringify(field.encoding ?? "ASCII")})`;
    }
    if (field.type === "bytes" && field.contents !== undefined) {
      return `io.expectContents([${Array.from(contentsBytes(field.contents)).join(", ")}], ${JSON.stringify(`${typeName}.${field.id}`)})`;
    }
    if (field.type === "bytes" || field.type === "str") {
      const raw = this.rawBytesCode(field, typeName);
      const bytes = field.process === "zlib" ? `inflate(${raw})` : raw;
      return field.type === "str" ? `decode(${bytes}, ${JSON.stringify(field.encoding ?? "ASCII")})` : bytes;
    }
    const parse = readFunctionName(field.type);
    if (field.size === undefined && !field.sizeEos) {
      return `${parse}(io, self, root)`;
    }
    const raw = this.rawBytesCode(field, typeName);
    const stream = field.process === "zlib" ? `new ByteStream(inflate(${raw}))` : `new ByteStream(${raw})`;
    return `${parse}(${stream}, self, root)`;
  }

  private assignment(field: NamedField, typeName: string, indent: string): string[] {
    const item = this.itemCode(field, typeName);
    if (field.repeat === "expr") {
      return [
        `${indent}self.${field.id} = [];`,
        `${indent}for (let index = 0, count = ${this.expression(field.repeatExpr ?? 0, typeName)}; index < count; index += 1) {`,
        `${indent}  self.${field.id}.push(${item});`,
        `${indent}}`,
      ];
    }
    if (field.repeat === "eos") {
      return [`${indent}self.${field.id} = [];`, `${indent}while (!io.eof) {`, `${indent}  self.${field.id}.push(${item});`, `${indent}}`];
    }
    return [`${indent}self.${field.id} = ${item};`];
  }

  private guarded(field: NamedField, typeName: string, body: (indent: string) => string[]): string[] {
    if (field.if === undefined) {
      return body("  ");
    }
    return [`  if (${this.expression(field.if, typeName)}) {`, ...body("    "), "  }"];
  }

  private checkSeqReferences(name: string, spec: TypeSpec): void {
    const instanceNames = new Set(Object.keys(spec.instances ?? {}));
    for (const field of spec.seq) {
      for (const expression of [field.size, field.repeatExpr, field.if]) {
        const used = this.expressions.referencedLocals(expression).filter((local) => instanceNames.has(local));
        if (used.length > 0) {
          throw new EmitError(`${name}.${field.id} refers to instance ${used.join(", ")}; the emitted parser reads instances after the sequence`);
        }
      }
    }
  }

  private parseFunction(name: string, spec: TypeSpec): string {
    this.checkSeqReferences(name, spec);
    const isRoot = name === this.layout.id;
    const parents = this.types.parentTypes(name).map((parent) => pascalCase(parent));
    const parentType = parents.length > 0 ? parents.join(" | ") : "null";
    const rootType = pascalCase(this.layout.id);
    const lines: string[] = [];
    lines.push(
      isRoot
        ? `function ${readFunctionName(name)}(io: ByteStream, parent: null, rootOrSelf: ${rootType} | null): ${rootType} {`
        : `function ${readFunctionName(name)}(io: ByteStream, parent: ${parentType}, root: ${rootType}): ${pascalCase(name)} {`,
    );
    lines.push(`  const self = {} as ${pascalCase(name)};`);
    if (isRoot) {
      lines.push("  const root = rootOrSelf ?? self;");
    }
    lines.push("  void parent;", "  void root;");
    for (const field of spec.seq) {
      lines.push(...this.guarded(field, name, (indent) => this.assignment(field, name, indent)));
    }
    for (const instance of orderInstances(spec, (expression) => this.expressions.referencedLocals(expression))) {
      const opening = instance.if === undefined ? "  {" : `  if (${this.expression(instance.if, name)}) {`;
      lines.push(
        opening,
        "    const saved = io.pos;",
        `    io.seek(${this.expression(instance.pos ?? 0, name)});`,
        ...this.assignment(instance, name, "    "),
        "    io.seek(saved);",
        "  }",
      );
    }
    lines.push("  return self;", "}\n");
    return lines.join("\n");
  }

  private entryFunction(): string {
    const name = this.layout.id;
    return `export function ${parseFunctionName(name)}(bytes: Uint8Array): ${pascalCase(name)} {\n  return ${readFunctionName(name)}(new ByteStream(bytes), null, null);\n}\n`;
  }
}

export function emitTypeScriptParser(layout: Layout): string {
  return new ParserWriter(layout).write();
}
