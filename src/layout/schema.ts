import { z } from "zod";

export const identifierPattern = /^[a-z][a-z0-9_]*$/;

export const integerBaseTypes = ["u1", "u2", "u4", "u8", "s1", "s2", "s4", "s8"] as const;
export const floatBaseTypes = ["f4", "f8"] as const;
export const builtinNonScalarTypes = ["bytes", "str", "strz"] as const;

const identifier = z.string().regex(identifierPattern, "use snake_case starting with a letter");
const expression = z.union([z.number().int(), z.string().min(1)]);

export const fieldSchema = z
  .object({
    id: identifier,
    type: z.string().min(1).describe("u1..u8, s1..s8, f4, f8 with optional le/be suffix, bytes, str, strz, or a name from types"),
    endian: z.enum(["le", "be"]).optional(),
    size: expression.optional(),
    sizeEos: z.boolean().optional(),
    encoding: z.string().optional(),
    contents: z.union([z.array(z.number().int().min(0).max(255)), z.string()]).optional(),
    repeat: z.enum(["eos", "expr"]).optional(),
    repeatExpr: expression.optional(),
    if: expression.optional(),
    process: z.enum(["zlib"]).optional(),
    doc: z.string().optional(),
  })
  .strict();

export const instanceSchema = fieldSchema.omit({ id: true }).extend({ pos: expression }).strict();

export const typeSchema = z
  .object({
    doc: z.string().optional(),
    seq: z.array(fieldSchema).default([]),
    instances: z.record(identifier, instanceSchema).optional(),
  })
  .strict();

export const layoutSchema = z
  .object({
    id: identifier,
    title: z.string().optional(),
    doc: z.string().optional(),
    fileExtension: z.string().optional(),
    endian: z.enum(["le", "be"]),
    seq: z.array(fieldSchema).default([]),
    instances: z.record(identifier, instanceSchema).optional(),
    types: z.record(identifier, typeSchema).optional(),
  })
  .strict();

export type FieldSpec = z.infer<typeof fieldSchema>;
export type InstanceSpec = z.infer<typeof instanceSchema>;
export type TypeSpec = z.infer<typeof typeSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type Expression = z.infer<typeof expression>;

export interface NamedField extends Omit<FieldSpec, "id"> {
  id: string;
  pos?: Expression;
}

export function instanceFields(instances: TypeSpec["instances"]): NamedField[] {
  return Object.entries(instances ?? {}).map(([id, instance]) => ({ ...instance, id }));
}

export function rootType(layout: Layout): TypeSpec {
  return { seq: layout.seq, ...(layout.instances ? { instances: layout.instances } : {}), ...(layout.doc ? { doc: layout.doc } : {}) };
}
