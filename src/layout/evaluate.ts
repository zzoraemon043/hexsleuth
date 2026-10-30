import { parseExpression, type ExpressionNode } from "./expression.js";
import type { Expression } from "./schema.js";
import { ParsedObject, type Value } from "./values.js";

export class EvaluationError extends Error {}

export type NameResolver = (object: ParsedObject, name: string) => Value;

function memberOf(value: Value, property: string, resolve: NameResolver): Value {
  if (value instanceof ParsedObject) {
    return resolve(value, property);
  }
  if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array) && value.kind === "io") {
    if (property === "size") {
      return value.stream.size;
    }
    if (property === "pos") {
      return value.stream.pos;
    }
    if (property === "eof") {
      return value.stream.isEof;
    }
  }
  if ((Array.isArray(value) || value instanceof Uint8Array) && property === "size") {
    return value.length;
  }
  if (typeof value === "string" && property === "length") {
    return value.length;
  }
  throw new EvaluationError(`cannot read .${property} of ${describeValue(value)}`);
}

function describeValue(value: Value): string {
  if (value instanceof ParsedObject) {
    return `an object of type ${value.typeName}`;
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return value instanceof Uint8Array ? "a byte array" : typeof value;
}

function asNumber(value: Value, context: string): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  throw new EvaluationError(`${context} needs a number, got ${describeValue(value)}`);
}

function binary(operator: string, left: Value, right: Value): Value {
  if (operator === "==" || operator === "!=") {
    const equal = left === right;
    return operator === "==" ? equal : !equal;
  }
  const a = asNumber(left, operator);
  const b = asNumber(right, operator);
  switch (operator) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/":
      if (b === 0) {
        throw new EvaluationError("division by zero");
      }
      return Math.floor(a / b);
    case "%":
      if (b === 0) {
        throw new EvaluationError("modulo by zero");
      }
      return ((a % b) + b) % b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    default: return a >= b;
  }
}

function evaluateNode(node: ExpressionNode, scope: ParsedObject, resolve: NameResolver): Value {
  switch (node.kind) {
    case "number":
    case "boolean":
    case "string":
      return node.value;
    case "name":
      return resolve(scope, node.name);
    case "member":
      return memberOf(evaluateNode(node.object, scope, resolve), node.property, resolve);
    case "index": {
      const target = evaluateNode(node.object, scope, resolve);
      const index = asNumber(evaluateNode(node.index, scope, resolve), "index");
      if (!Array.isArray(target) && !(target instanceof Uint8Array)) {
        throw new EvaluationError(`cannot index ${describeValue(target)}`);
      }
      const item = target[index];
      if (item === undefined) {
        throw new EvaluationError(`index ${index} is outside an array of ${target.length}`);
      }
      return item;
    }
    case "unary": {
      const operand = evaluateNode(node.operand, scope, resolve);
      return node.operator === "not" ? !operand : -asNumber(operand, "negation");
    }
    case "binary": {
      if (node.operator === "and" || node.operator === "or") {
        const isOr = node.operator === "or";
        const left = Boolean(evaluateNode(node.left, scope, resolve));
        return left === isOr ? isOr : Boolean(evaluateNode(node.right, scope, resolve));
      }
      return binary(node.operator, evaluateNode(node.left, scope, resolve), evaluateNode(node.right, scope, resolve));
    }
  }
}

export function evaluate(expression: Expression, scope: ParsedObject, resolve: NameResolver): Value {
  return evaluateNode(parseExpression(expression), scope, resolve);
}

export function evaluateNumber(expression: Expression, scope: ParsedObject, resolve: NameResolver, context: string): number {
  const value = evaluate(expression, scope, resolve);
  const number = asNumber(value, context);
  if (!Number.isInteger(number)) {
    throw new EvaluationError(`${context} must be an integer, got ${number}`);
  }
  return number;
}
