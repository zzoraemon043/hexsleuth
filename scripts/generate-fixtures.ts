import { resolve } from "node:path";
import { generateFixtures } from "./fixtures/index.js";

const outputDirectory = resolve(process.argv[2] ?? "fixtures");
const manifest = generateFixtures(outputDirectory);
for (const [format, files] of Object.entries(manifest)) {
  process.stdout.write(`${format}: ${files.length} samples\n`);
}
