import { instanceFields, type Expression, type NamedField, type TypeSpec } from "../layout/schema.js";
import { EmitError } from "./naming.js";

export function orderInstances(spec: TypeSpec, localsOf: (expression: Expression | undefined) => string[]): NamedField[] {
  const instances = instanceFields(spec.instances);
  const byName = new Map(instances.map((instance) => [instance.id, instance]));
  const ordered: NamedField[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (instance: NamedField): void => {
    if (state.get(instance.id) === "done") {
      return;
    }
    if (state.get(instance.id) === "visiting") {
      throw new EmitError(`instance ${instance.id} depends on itself`);
    }
    state.set(instance.id, "visiting");
    for (const expression of [instance.pos, instance.size, instance.repeatExpr, instance.if]) {
      for (const local of localsOf(expression)) {
        const dependency = byName.get(local);
        if (dependency) {
          visit(dependency);
        }
      }
    }
    state.set(instance.id, "done");
    ordered.push(instance);
  };
  instances.forEach(visit);
  return ordered;
}
