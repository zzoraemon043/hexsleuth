export type ExpressionNode =
  | { kind: "number"; value: number; exact?: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "string"; value: string }
  | { kind: "name"; name: string }
  | { kind: "member"; object: ExpressionNode; property: string }
  | { kind: "index"; object: ExpressionNode; index: ExpressionNode }
  | { kind: "unary"; operator: "-" | "not"; operand: ExpressionNode }
  | { kind: "binary"; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode };

export type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or";

interface Token {
  kind: "number" | "string" | "name" | "symbol" | "end";
  text: string;
  position: number;
}

const symbols = ["==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "<", ">", "(", ")", "[", "]", "."];

const precedence: Record<string, number> = {
  or: 1,
  and: 2,
  "==": 3,
  "!=": 3,
  "<": 3,
  "<=": 3,
  ">": 3,
  ">=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "%": 5,
};

export class ExpressionError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < source.length) {
    const rest = source.slice(position);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      position += whitespace[0].length;
      continue;
    }
    const number = /^(0x[0-9a-fA-F]+|\d+)/.exec(rest);
    if (number) {
      tokens.push({ kind: "number", text: number[0], position });
      position += number[0].length;
      continue;
    }
    const quoted = /^"([^"\\]*)"|^'([^'\\]*)'/.exec(rest);
    if (quoted) {
      tokens.push({ kind: "string", text: quoted[1] ?? quoted[2] ?? "", position });
      position += quoted[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (name) {
      tokens.push({ kind: "name", text: name[0], position });
      position += name[0].length;
      continue;
    }
    const symbol = symbols.find((candidate) => rest.startsWith(candidate));
    if (!symbol) {
      throw new ExpressionError(`unexpected character "${rest.charAt(0)}" at ${position} in "${source}"`);
    }
    tokens.push({ kind: "symbol", text: symbol, position });
    position += symbol.length;
  }
  tokens.push({ kind: "end", text: "", position });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  parse(): ExpressionNode {
    const node = this.parseBinary(0);
    if (this.peek().kind !== "end") {
      this.fail(`unexpected "${this.peek().text}"`);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index] as Token;
  }

  private next(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private fail(message: string): never {
    throw new ExpressionError(`${message} at ${this.peek().position} in "${this.source}"`);
  }

  private expect(text: string): void {
    const token = this.next();
    if (token.kind !== "symbol" || token.text !== text) {
      this.fail(`expected "${text}"`);
    }
  }

  private parseBinary(minimum: number): ExpressionNode {
    let left = this.parseUnary();
    for (;;) {
      const operator = this.peek().text;
      const level = Object.hasOwn(precedence, operator) ? precedence[operator] : undefined;
      if (level === undefined || level <= minimum || this.peek().kind !== "symbol" && this.peek().kind !== "name") {
        return left;
      }
      this.next();
      const right = this.parseBinary(level);
      left = { kind: "binary", operator: operator as BinaryOperator, left, right };
    }
  }

  private parseUnary(): ExpressionNode {
    const token = this.peek();
    if ((token.kind === "symbol" && token.text === "-") || (token.kind === "name" && token.text === "not")) {
      this.next();
      const operand = this.parseUnary();
      if (token.text === "-" && operand.kind === "number" && operand.exact !== undefined) {
        return { kind: "number", value: -operand.value, exact: `-${operand.exact}` };
      }
      return { kind: "unary", operator: token.text as "-" | "not", operand };
    }
    return this.parsePostfix(this.parsePrimary());
  }

  private parsePrimary(): ExpressionNode {
    const token = this.next();
    if (token.kind === "number") {
      const exact = BigInt(token.text);
      return exact > BigInt(Number.MAX_SAFE_INTEGER) ? { kind: "number", value: Number(exact), exact: exact.toString() } : { kind: "number", value: Number(token.text) };
    }
    if (token.kind === "string") {
      return { kind: "string", value: token.text };
    }
    if (token.kind === "name") {
      if (token.text === "true" || token.text === "false") {
        return { kind: "boolean", value: token.text === "true" };
      }
      return { kind: "name", name: token.text };
    }
    if (token.kind === "symbol" && token.text === "(") {
      const inner = this.parseBinary(0);
      this.expect(")");
      return inner;
    }
    this.index -= 1;
    return this.fail(`unexpected "${token.text || "end"}"`);
  }

  private parsePostfix(node: ExpressionNode): ExpressionNode {
    let current = node;
    for (;;) {
      const token = this.peek();
      const symbol = token.kind === "symbol" ? token.text : "";
      if (symbol === ".") {
        this.next();
        const property = this.next();
        if (property.kind !== "name") {
          this.fail("expected a name after .");
        }
        current = { kind: "member", object: current, property: property.text };
      } else if (symbol === "[") {
        this.next();
        const index = this.parseBinary(0);
        this.expect("]");
        current = { kind: "index", object: current, index };
      } else {
        return current;
      }
    }
  }
}

const cache = new Map<string, ExpressionNode>();

export function parseExpression(source: string | number): ExpressionNode {
  if (typeof source === "number") {
    return { kind: "number", value: source };
  }
  const cached = cache.get(source);
  if (cached) {
    return cached;
  }
  const node = new Parser(tokenize(source), source).parse();
  cache.set(source, node);
  return node;
}

export function localNames(node: ExpressionNode): string[] {
  switch (node.kind) {
    case "name":
      return node.name.startsWith("_") ? [] : [node.name];
    case "member":
      return localNames(node.object);
    case "index":
      return [...localNames(node.object), ...localNames(node.index)];
    case "unary":
      return localNames(node.operand);
    case "binary":
      return [...localNames(node.left), ...localNames(node.right)];
    default:
      return [];
  }
}
