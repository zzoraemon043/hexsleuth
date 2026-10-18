import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../mcp/server.js";
import { describeTools, errorMessage, formatOutput, invokeTool, tools } from "../tools/registry.js";
import { packageVersion } from "../version.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => string;
}

const usage = `Usage:
  hexsleuth <tool> '<json input>'
  hexsleuth <tool> --input <file.json>
  hexsleuth <tool> -            read the JSON input from standard input
  hexsleuth tools               list the tools with their input schemas
  hexsleuth mcp                 run the MCP server on standard input and output
  hexsleuth --version

Tools: ${tools.map((tool) => tool.name).join(", ")}

The JSON input and output are the same as the MCP tools.
`;

function readInput(args: string[], io: CliIo): unknown {
  const [first, second] = args;
  if (first === undefined) {
    return {};
  }
  if (first === "--input") {
    if (second === undefined) {
      throw new Error("--input needs a file path");
    }
    return JSON.parse(readFileSync(second, "utf8"));
  }
  if (first === "-") {
    return JSON.parse(io.readStdin());
  }
  return JSON.parse(first);
}

export async function runCli(args: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = args;
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    io.stdout(usage);
    return command === undefined ? 1 : 0;
  }
  if (command === "--version") {
    io.stdout(`${packageVersion}\n`);
    return 0;
  }
  if (command === "tools") {
    io.stdout(formatOutput(describeTools()));
    return 0;
  }
  if (command === "mcp") {
    await createServer().connect(new StdioServerTransport());
    return -1;
  }
  try {
    io.stdout(formatOutput(await invokeTool(command, readInput(rest, io))));
    return 0;
  } catch (error) {
    io.stderr(formatOutput({ error: errorMessage(error) }));
    return 1;
  }
}
