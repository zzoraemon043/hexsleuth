import { z } from "zod";

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape, Output = unknown> {
  name: string;
  title: string;
  description: string;
  inputShape: Shape;
  run(input: z.infer<z.ZodObject<Shape>>): Output | Promise<Output>;
}

export function defineTool<Shape extends z.ZodRawShape, Output>(
  definition: ToolDefinition<Shape, Output>,
): ToolDefinition<Shape, Output> {
  return definition;
}

export async function runTool<Shape extends z.ZodRawShape, Output>(
  tool: ToolDefinition<Shape, Output>,
  rawInput: unknown,
): Promise<Output> {
  const input = z.object(tool.inputShape).parse(rawInput);
  return tool.run(input);
}
