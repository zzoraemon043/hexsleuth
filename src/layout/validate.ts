import { parseExpression } from "./expression.js";
import { instanceFields, rootType, type Expression, type Layout, type NamedField, type TypeSpec } from "./schema.js";
import { isBuiltinType, parseScalarType, textDecoderLabel } from "./types.js";

function expressionErrors(where: string, expression: Expression | undefined): string[] {
  if (expression === undefined) {
    return [];
  }
  try {
    parseExpression(expression);
    return [];
  } catch (error) {
    return [`${where}: ${(error as Error).message}`];
  }
}

function encodingErrors(where: string, encoding: string | undefined): string[] {
  if (encoding === undefined) {
    return [`${where}: strings need an encoding`];
  }
  try {
    new TextDecoder(textDecoderLabel(encoding));
    return [];
  } catch {
    return [`${where}: unknown encoding ${encoding}`];
  }
}

function fieldErrors(where: string, field: NamedField, knownTypes: Set<string>): string[] {
  const errors: string[] = [];
  if (!isBuiltinType(field.type) && !knownTypes.has(field.type)) {
    errors.push(`${where}: unknown type ${field.type}`);
  }
  const hasSize = field.size !== undefined || field.sizeEos === true;
  if ((field.type === "bytes" || field.type === "str") && !hasSize && field.contents === undefined) {
    errors.push(`${where}: ${field.type} needs size or sizeEos`);
  }
  if (field.type === "str" || field.type === "strz") {
    errors.push(...encodingErrors(where, field.encoding));
  }
  if (parseScalarType(field.type) !== undefined || field.type === "strz") {
    for (const [label, present] of [["size", field.size !== undefined], ["sizeEos", field.sizeEos !== undefined], ["process", field.process !== undefined]] as const) {
      if (present) {
        errors.push(`${where}: ${label} is not allowed on ${field.type}`);
      }
    }
  }
  if (field.contents !== undefined && field.type !== "bytes") {
    errors.push(`${where}: contents is only allowed on bytes`);
  }
  if (field.repeat === "expr" && field.repeatExpr === undefined) {
    errors.push(`${where}: repeat expr needs repeatExpr`);
  }
  if (field.repeatExpr !== undefined && field.repeat !== "expr") {
    errors.push(`${where}: repeatExpr needs repeat set to expr`);
  }
  if (field.process !== undefined && !hasSize) {
    errors.push(`${where}: process needs size or sizeEos`);
  }
  if (field.size !== undefined && field.sizeEos === true) {
    errors.push(`${where}: use either size or sizeEos`);
  }
  for (const [label, expression] of [["size", field.size], ["repeatExpr", field.repeatExpr], ["if", field.if], ["pos", field.pos]] as const) {
    errors.push(...expressionErrors(`${where}.${label}`, expression));
  }
  return errors;
}

function typeErrors(typeName: string, spec: TypeSpec, knownTypes: Set<string>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const fields = [...spec.seq, ...instanceFields(spec.instances)];
  for (const field of fields) {
    if (seen.has(field.id)) {
      errors.push(`${typeName}.${field.id}: duplicate id`);
    }
    seen.add(field.id);
    errors.push(...fieldErrors(`${typeName}.${field.id}`, field, knownTypes));
  }
  return errors;
}

export function validateLayout(layout: Layout): string[] {
  const knownTypes = new Set(Object.keys(layout.types ?? {}));
  const errors = typeErrors(layout.id, rootType(layout), knownTypes);
  for (const [name, spec] of Object.entries(layout.types ?? {})) {
    if (isBuiltinType(name)) {
      errors.push(`types.${name}: shadows a built-in type`);
    }
    errors.push(...typeErrors(name, spec, knownTypes));
  }
  return errors;
}
