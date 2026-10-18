import { readFileSync } from "node:fs";
import { layoutSchema, type Layout } from "./schema.js";
import { validateLayout } from "./validate.js";

export class LayoutError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid layout: ${problems.join("; ")}`);
  }
}

export function parseLayout(raw: unknown): Layout {
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LayoutError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "layout"}: ${issue.message}`));
  }
  const problems = validateLayout(parsed.data);
  if (problems.length > 0) {
    throw new LayoutError(problems);
  }
  return parsed.data;
}

export function resolveLayout(input: { layout?: unknown; layoutFile?: string | undefined }): Layout {
  if (input.layout !== undefined) {
    return parseLayout(input.layout);
  }
  if (input.layoutFile !== undefined) {
    return parseLayout(JSON.parse(readFileSync(input.layoutFile, "utf8")));
  }
  throw new LayoutError(["give either layout or layoutFile"]);
}
