import { instanceFields, rootType, type Layout, type NamedField, type TypeSpec } from "../layout/schema.js";
import { parseScalarType } from "../layout/types.js";
import { EmitError } from "./naming.js";

export type StaticType =
  | { kind: "int" | "int64" | "float" | "bool" | "string" | "bytes" | "io" }
  | { kind: "user"; name: string }
  | { kind: "array"; element: StaticType };

export interface ResolvedField {
  field: NamedField;
  type: StaticType;
  optional: boolean;
}

export class LayoutTypes {
  private readonly parents = new Map<string, Set<string>>();

  constructor(readonly layout: Layout) {
    for (const [name, spec] of this.allTypes()) {
      for (const field of this.fieldsOf(spec)) {
        if (this.isUserType(field.type)) {
          const set = this.parents.get(field.type) ?? new Set<string>();
          set.add(name);
          this.parents.set(field.type, set);
        }
      }
    }
  }

  allTypes(): [string, TypeSpec][] {
    return [[this.layout.id, rootType(this.layout)], ...Object.entries(this.layout.types ?? {})];
  }

  spec(typeName: string): TypeSpec {
    if (typeName === this.layout.id) {
      return rootType(this.layout);
    }
    const spec = this.layout.types?.[typeName];
    if (!spec) {
      throw new EmitError(`unknown type ${typeName}`);
    }
    return spec;
  }

  fieldsOf(spec: TypeSpec): NamedField[] {
    return [...spec.seq, ...instanceFields(spec.instances)];
  }

  isUserType(type: string): boolean {
    return type !== "bytes" && type !== "str" && type !== "strz" && parseScalarType(type) === undefined;
  }

  parentTypes(typeName: string): string[] {
    return [...(this.parents.get(typeName) ?? [])];
  }

  itemType(field: NamedField): StaticType {
    const scalar = parseScalarType(field.type);
    if (scalar) {
      return { kind: scalar.kind === "float" ? "float" : scalar.width === 8 ? "int64" : "int" };
    }
    if (field.type === "str" || field.type === "strz") {
      return { kind: "string" };
    }
    if (field.type === "bytes") {
      return { kind: "bytes" };
    }
    return { kind: "user", name: field.type };
  }

  fieldType(field: NamedField): StaticType {
    const item = this.itemType(field);
    return field.repeat ? { kind: "array", element: item } : item;
  }

  resolveField(typeName: string, name: string): ResolvedField {
    const field = this.fieldsOf(this.spec(typeName)).find((candidate) => candidate.id === name);
    if (!field) {
      throw new EmitError(`unknown name ${name} in ${typeName}`);
    }
    return { field, type: this.fieldType(field), optional: field.if !== undefined };
  }

  singleParent(typeName: string): string {
    const parents = this.parentTypes(typeName);
    if (parents.length !== 1 || parents[0] === undefined) {
      throw new EmitError(`_parent in ${typeName} needs exactly one parent type, found ${parents.length}`);
    }
    return parents[0];
  }
}
