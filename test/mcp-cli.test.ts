import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/run.js";
import { createServer } from "../src/mcp/server.js";
import { tools } from "../src/tools/registry.js";
import { exampleLayoutPath } from "./helpers-layout.js";
import { fixtureManifest, fixtureNamed, fixturePaths } from "./helpers.js";

const scratch = mkdtempSync(join(tmpdir(), "hexsleuth-mcp-"));
const client = new Client({ name: "hexsleuth-test", version: "0.0.0" });

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function cli(args: string[], stdin = ""): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = await runCli(args, { stdout: (text) => (stdout += text), stderr: (text) => (stderr += text), readStdin: () => stdin });
  return { code, stdout, stderr };
}

const zlibFixture = fixtureNamed("compression", "zlib.bin");

const toolInputs: Record<string, Record<string, unknown>> = {
  probe: { file: fixturePaths("png")[0] },
  compare: { files: fixturePaths("wav") },
  infer_fields: { files: fixturePaths("hxsf") },
  detect_compression: { file: zlibFixture?.path, offset: zlibFixture?.facts?.offset, writeOutput: false },
  verify_layout: { files: fixturePaths("zip"), layoutFile: exampleLayoutPath("zip"), maxArrayItems: 2 },
  read_bytes: { file: fixturePaths("wav")[0], length: 44, interpret: ["u4le"] },
  emit: { files: fixturePaths("png"), layoutFile: exampleLayoutPath("png"), outDir: join(scratch, "emitted") },
};

describe("MCP server", () => {
  it("lists every tool with its input schema", async () => {
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(tools.map((tool) => tool.name).sort());
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["compare", "detect_compression", "emit", "infer_fields", "probe", "read_bytes", "verify_layout"]);
    for (const tool of listed.tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("returns tool errors as isError results with the same JSON as the CLI", async () => {
    const input = { file: "does/not/exist.bin" };
    const result = await client.callTool({ name: "probe", arguments: input });
    expect(result.isError).toBe(true);
    const fromCli = await cli(["probe", JSON.stringify(input)]);
    expect(fromCli.code).toBe(1);
    const [content] = result.content as { type: string; text: string }[];
    expect(content?.text).toBe(fromCli.stderr);
    expect(JSON.parse(fromCli.stderr).error).toMatch(/ENOENT/);
  });
});

describe("CLI and MCP parity", () => {
  for (const [name, input] of Object.entries(toolInputs)) {
    it(`${name} gives the same output through MCP and the CLI`, async () => {
      const result = await client.callTool({ name, arguments: input });
      expect(result.isError ?? false).toBe(false);
      const [content] = result.content as { type: string; text: string }[];
      const fromCli = await cli([name, JSON.stringify(input)]);
      expect(fromCli.code, fromCli.stderr).toBe(0);
      expect(content?.text).toBe(fromCli.stdout);
      expect(result.structuredContent).toEqual(JSON.parse(fromCli.stdout));
    });
  }
});

describe("CLI", () => {
  it("reads input from a file and from standard input", async () => {
    const inputPath = join(scratch, "input.json");
    writeFileSync(inputPath, JSON.stringify(toolInputs.read_bytes));
    const fromFile = await cli(["read_bytes", "--input", inputPath]);
    const fromStdin = await cli(["read_bytes", "-"], JSON.stringify(toolInputs.read_bytes));
    const inline = await cli(["read_bytes", JSON.stringify(toolInputs.read_bytes)]);
    expect(fromFile.stdout).toBe(inline.stdout);
    expect(fromStdin.stdout).toBe(inline.stdout);
  });

  it("reports invalid input as a JSON error", async () => {
    const result = await cli(["compare", JSON.stringify({ files: ["only-one"] })]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).error).toMatch(/^invalid input: files:/);
  });

  it("lists tools, prints the version and shows usage", async () => {
    const listed = await cli(["tools"]);
    expect((JSON.parse(listed.stdout) as { name: string }[]).map((tool) => tool.name)).toContain("infer_fields");
    expect((await cli(["--version"])).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect((await cli(["--help"])).stdout).toContain("hexsleuth <tool>");
  });

  it("runs as a process", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", resolve("src/cli/main.ts"), "read_bytes", JSON.stringify(toolInputs.read_bytes)], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).rows[0].ascii).toBe("RIFF....WAVEfmt ");
  });
});

describe("MCP over standard input and output", () => {
  it("serves the tools to a stdio client", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", resolve("src/cli/main.ts"), "mcp"], stderr: "pipe" });
    const stdioClient = new Client({ name: "hexsleuth-stdio-test", version: "0.0.0" });
    await stdioClient.connect(transport);
    try {
      const listed = await stdioClient.listTools();
      expect(listed.tools).toHaveLength(7);
      const result = await stdioClient.callTool({ name: "read_bytes", arguments: toolInputs.read_bytes });
      expect((result.structuredContent as { size: number }).size).toBe(fixtureManifest().wav?.[0]?.size);
    } finally {
      await stdioClient.close();
    }
  }, 30000);
});
