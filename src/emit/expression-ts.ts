import { localNames, parseExpression, type ExpressionNode } from "../layout/expression.js";
import type { Expression } from "../layout/schema.js";
import { EmitError } from "./naming.js";
import type { LayoutTypes, StaticType } from "./static-types.js";

interface Translated {
  code: string;
  type: StaticType;
  raw?: Translated;
}

const intType: StaticType = { kind: "int" };

function asNumber(translated: Translated): Translated {
  return translated.type.kind === "int64" ? { code: `safeNumber(${translated.code})`, type: intType, raw: translated } : translated;
}
const boolType: StaticType = { kind: "bool" };

function optionalSuffix(optional: boolean): string {
  return optional ? "!" : "";
}

export class TypeScriptExpressions {
  constructor(private readonly types: LayoutTypes) {}

  translate(expression: Expression, typeName: string): string {
    return this.node(parseExpression(expression), typeName).code;
  }

  referencedLocals(expression: Expression | undefined): string[] {
    return expression === undefined ? [] : localNames(parseExpression(expression));
  }

  private node(node: ExpressionNode, typeName: string): Translated {
    switch (node.kind) {
      case "number":
        return { code: node.exact === undefined ? String(node.value) : `${node.exact}n`, type: intType };
      case "boolean":
        return { code: String(node.value), type: boolType };
      case "string":
        return { code: JSON.stringify(node.value), type: { kind: "string" } };
      case "name":
        return asNumber(this.name(node.name, typeName));
      case "member":
        return asNumber(this.member(this.node(node.object, typeName), node.property, node.object));
      case "index": {
        const target = this.node(node.object, typeName);
        const index = this.node(node.index, typeName);
        if (target.type.kind === "array") {
          return asNumber({ code: `${target.code}[${index.code}]!`, type: target.type.element });
        }
        if (target.type.kind === "bytes") {
          return { code: `${target.code}[${index.code}]!`, type: intType };
        }
        throw new EmitError("only arrays and byte arrays can be indexed");
      }
      case "unary": {
        const operand = this.node(node.operand, typeName);
        return node.operator === "not" ? { code: `!(${operand.code})`, type: boolType } : { code: `-(${operand.code})`, type: operand.type };
      }
      case "binary":
        return this.binary(node.operator, this.node(node.left, typeName), this.node(node.right, typeName));
    }
  }

  private name(name: string, typeName: string): Translated {
    if (name === "_root") {
      return { code: "root", type: { kind: "user", name: this.types.layout.id } };
    }
    if (name === "_parent") {
      return { code: "parent", type: { kind: "user", name: this.types.singleParent(typeName) } };
    }
    if (name === "_io") {
      return { code: "io", type: { kind: "io" } };
    }
    const resolved = this.types.resolveField(typeName, name);
    return { code: `self.${name}${optionalSuffix(resolved.optional)}`, type: resolved.type };
  }

  private member(object: Translated, property: string, source: ExpressionNode): Translated {
    if (object.type.kind === "user") {
      const resolved = this.types.resolveField(object.type.name, property);
      return { code: `${object.code}.${property}${optionalSuffix(resolved.optional)}`, type: resolved.type };
    }
    if (object.type.kind === "io") {
      if (source.kind !== "name") {
        throw new EmitError("only the current stream _io is supported");
      }
      if (property === "size" || property === "pos") {
        return { code: `io.${property}`, type: intType };
      }
      if (property === "eof") {
        return { code: "io.eof", type: boolType };
      }
    }
    if ((object.type.kind === "array" || object.type.kind === "bytes") && property === "size") {
      return { code: `${object.code}.length`, type: intType };
    }
    if (object.type.kind === "string" && property === "length") {
      return { code: `${object.code}.length`, type: intType };
    }
    throw new EmitError(`unsupported member .${property}`);
  }

  private binary(operator: string, wrappedLeft: Translated, wrappedRight: Translated): Translated {
    const comparison = ["==", "!=", "<", "<=", ">", ">="].includes(operator);
    const left = comparison ? (wrappedLeft.raw ?? wrappedLeft) : wrappedLeft;
    const right = comparison ? (wrappedRight.raw ?? wrappedRight) : wrappedRight;
    switch (operator) {
      case "and":
        return { code: `(${left.code} && ${right.code})`, type: boolType };
      case "or":
        return { code: `(${left.code} || ${right.code})`, type: boolType };
      case "==":
        return { code: `(${left.code} === ${right.code})`, type: boolType };
      case "!=":
        return { code: `(${left.code} !== ${right.code})`, type: boolType };
      case "/":
        return { code: `floorDiv(${left.code}, ${right.code})`, type: intType };
      case "%":
        return { code: `mod(${left.code}, ${right.code})`, type: intType };
      case "<":
      case "<=":
      case ">":
      case ">=":
        return { code: `(${left.code} ${operator} ${right.code})`, type: boolType };
      default:
        return { code: `(${left.code} ${operator} ${right.code})`, type: intType };
    }
  }
}
