import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Layout } from "../src/layout/schema.js";

export const exampleFormats = ["png", "zip", "wav", "hxsf"] as const;

export function exampleLayoutPath(format: string): string {
  return resolve("examples/layouts", `${format}.json`);
}

export function exampleLayout(format: string): Layout {
  return JSON.parse(readFileSync(exampleLayoutPath(format), "utf8")) as Layout;
}
