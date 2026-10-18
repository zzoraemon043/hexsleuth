#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runCli } from "./run.js";

const exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: () => readFileSync(0, "utf8"),
});

if (exitCode >= 0) {
  process.exitCode = exitCode;
}
