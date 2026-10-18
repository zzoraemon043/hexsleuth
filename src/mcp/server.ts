import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorMessage, formatOutput, invokeTool, tools } from "../tools/registry.js";
import { packageName, packageVersion } from "../version.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: packageName, version: packageVersion });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputShape },
      async (input: unknown) => {
        try {
          const output = (await invokeTool(tool.name, input)) as Record<string, unknown>;
          return { content: [{ type: "text" as const, text: formatOutput(output) }], structuredContent: output };
        } catch (error) {
          return { content: [{ type: "text" as const, text: formatOutput({ error: errorMessage(error) }) }], isError: true };
        }
      },
    );
  }
  return server;
}
