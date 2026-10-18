import { z } from "zod";
import { compareTool } from "./compare.js";
import { runTool, type ToolDefinition } from "./definition.js";
import { detectCompressionTool } from "./detect-compression.js";
import { emitTool } from "./emit.js";
import { inferFieldsTool } from "./infer-fields.js";
import { probeTool } from "./probe.js";
import { readBytesTool } from "./read-bytes.js";
import { verifyLayoutTool } from "./verify-layout.js";

export const tools: ToolDefinition[] = [
  probeTool,
  compareTool,
  inferFieldsTool,
  detectCompressionTool,
  verifyLayoutTool,
  readBytesTool,
  emitTool,
] as unknown as ToolDefinition[];

export function findTool(name: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === name);
}

export class UnknownToolError extends Error {}

export async function invokeTool(name: string, input: unknown): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) {
    throw new UnknownToolError(`unknown tool ${name}; available: ${tools.map((candidate) => candidate.name).join(", ")}`);
  }
  return runTool(tool, input);
}

export function describeTools(): { name: string; title: string; description: string; inputSchema: unknown }[] {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(z.object(tool.inputShape), { io: "input", unrepresentable: "any" }),
  }));
}

export function formatOutput(output: unknown): string {
  return `${JSON.stringify(output, null, 2)}\n`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return `invalid input: ${error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}`;
  }
  return error instanceof Error ? error.message : String(error);
}
