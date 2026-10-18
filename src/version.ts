import { createRequire } from "node:module";

const packageJson = createRequire(import.meta.url)("../package.json") as { name: string; version: string };

export const packageName = packageJson.name;
export const packageVersion = packageJson.version;
