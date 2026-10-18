export function pascalCase(identifier: string): string {
  return identifier
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function parseFunctionName(typeName: string): string {
  return `parse${pascalCase(typeName)}`;
}

export function readFunctionName(typeName: string): string {
  return `read${pascalCase(typeName)}`;
}

export class EmitError extends Error {}
