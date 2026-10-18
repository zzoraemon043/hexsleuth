import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { compressionFixtures } from "./compression.js";
import { buildHxsf, hxsfDocuments } from "./hxsf.js";
import { buildPng, pngSamples } from "./png.js";
import { randomText, seededRandom } from "./random.js";
import { buildWav, wavSamples } from "./wav.js";
import { buildZip, type ZipEntry } from "./zip.js";

export interface FixtureFile {
  path: string;
  size: number;
  facts?: Record<string, string | number>;
}

export type FixtureManifest = Record<string, FixtureFile[]>;

type NamedBytes = [name: string, bytes: Uint8Array, facts?: Record<string, string | number>];

function zipSamples(): ZipEntry[][] {
  const random = seededRandom(31);
  const entryCounts = [1, 2, 3, 4, 2, 5];
  return entryCounts.map((count, sampleIndex) =>
    Array.from({ length: count }, (_, entryIndex) => ({
      name: `dir${sampleIndex}/file-${entryIndex}.txt`,
      content: randomText(random, 40 + 120 * entryIndex),
      method: (sampleIndex + entryIndex) % 2 === 0 ? 8 : 0,
    })),
  );
}

function fixtureSets(): Record<string, NamedBytes[]> {
  const pngRandom = seededRandom(7);
  return {
    png: pngSamples.map((options, index) => [`sample-${index + 1}.png`, buildPng(options, pngRandom)]),
    zip: zipSamples().map((entries, index) => [`sample-${index + 1}.zip`, buildZip(entries)]),
    wav: wavSamples.map((options, index) => [`sample-${index + 1}.wav`, buildWav(options)]),
    hxsf: hxsfDocuments(seededRandom(53)).map((document, index) => [`sample-${index + 1}.hxsf`, buildHxsf(document)]),
    compression: compressionFixtures().map((fixture) => [fixture.name, fixture.bytes, fixture.facts]),
  };
}

export function generateFixtures(outputDirectory: string, baseDirectory = process.cwd()): FixtureManifest {
  const manifest: FixtureManifest = {};
  for (const [format, files] of Object.entries(fixtureSets())) {
    const directory = join(outputDirectory, format);
    mkdirSync(directory, { recursive: true });
    manifest[format] = files.map(([name, bytes, facts]) => {
      const path = join(directory, name);
      writeFileSync(path, bytes);
      return { path: relative(baseDirectory, path), size: bytes.length, ...(facts ? { facts } : {}) };
    });
  }
  writeFileSync(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
