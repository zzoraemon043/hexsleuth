import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FixtureManifest } from "../scripts/fixtures/index.js";

export function fixtureManifest(): FixtureManifest {
  return JSON.parse(readFileSync(resolve("fixtures/manifest.json"), "utf8")) as FixtureManifest;
}

export function fixturePaths(format: string): string[] {
  return (fixtureManifest()[format] ?? []).map((file) => file.path);
}

export function readFixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
