import { instanceFields, rootType, type Expression, type Layout, type NamedField, type TypeSpec } from "../layout/schema.js";
import { contentsBytes, parseScalarType } from "../layout/types.js";

type YamlValue = string | number | boolean | YamlValue[] | { [key: string]: YamlValue | undefined };

const plainScalar = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const reservedPlainWords = new Set(["true", "false", "null", "yes", "no", "on", "off", "y", "n", "~"]);

function scalar(value: string | number | boolean): string {
  if (typeof value !== "string") {
    return String(value);
  }
  return plainScalar.test(value) && !reservedPlainWords.has(value.toLowerCase()) ? value : JSON.stringify(value);
}

function isFlowList(value: YamlValue[]): boolean {
  return value.every((item) => typeof item === "number");
}

function render(value: YamlValue, indent: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const [first, ...rest] = render(item, `${indent}  `);
      return [`${indent}- ${(first ?? "").trimStart()}`, ...rest];
    });
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => {
      if (item === undefined) {
        return [];
      }
      if (Array.isArray(item) && isFlowList(item)) {
        return [`${indent}${key}: [${item.map((entry) => `0x${(entry as number).toString(16).padStart(2, "0")}`).join(", ")}]`];
      }
      if (typeof item === "object") {
        return [`${indent}${key}:`, ...render(item, `${indent}  `)];
      }
      return [`${indent}${key}: ${scalar(item)}`];
    });
  }
  return [`${indent}${scalar(value)}`];
}

function expressionValue(expression: Expression | undefined): string | number | undefined {
  return expression;
}

function kaitaiType(field: NamedField, layout: Layout): string | undefined {
  if (field.type === "bytes") {
    return undefined;
  }
  const scalarType = parseScalarType(field.type);
  if (scalarType && scalarType.endian === null && field.endian !== undefined && field.endian !== layout.endian) {
    return `${field.type}${field.endian}`;
  }
  return field.type;
}

function fieldEntries(field: NamedField, layout: Layout, includeId: boolean): Record<string, YamlValue | undefined> {
  return {
    ...(includeId ? { id: field.id } : {}),
    ...(field.pos !== undefined ? { pos: expressionValue(field.pos) } : {}),
    type: kaitaiType(field, layout),
    contents: field.contents === undefined ? undefined : Array.from(contentsBytes(field.contents)),
    size: expressionValue(field.size),
    "size-eos": field.sizeEos,
    encoding: field.encoding,
    process: field.process,
    repeat: field.repeat,
    "repeat-expr": expressionValue(field.repeatExpr),
    if: expressionValue(field.if),
    doc: field.doc,
  };
}

function typeEntries(spec: TypeSpec, layout: Layout): Record<string, YamlValue | undefined> {
  const instances = instanceFields(spec.instances);
  return {
    doc: spec.doc,
    seq: spec.seq.length > 0 ? spec.seq.map((field) => fieldEntries(field, layout, true)) : undefined,
    instances:
      instances.length > 0
        ? Object.fromEntries(instances.map((instance) => [instance.id, fieldEntries(instance, layout, false)]))
        : undefined,
  };
}

export function emitKaitaiStruct(layout: Layout): string {
  const document: Record<string, YamlValue | undefined> = {
    meta: {
      id: layout.id,
      title: layout.title,
      "file-extension": layout.fileExtension,
      endian: layout.endian,
    },
    ...typeEntries(rootType(layout), layout),
    types:
      layout.types && Object.keys(layout.types).length > 0
        ? Object.fromEntries(Object.entries(layout.types).map(([name, spec]) => [name, typeEntries(spec, layout)]))
        : undefined,
  };
  return `${render(document, "").join("\n")}\n`;
}
