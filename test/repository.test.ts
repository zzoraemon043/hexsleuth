import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const textExtensions = /\.(ts|js|json|md|yml|yaml|ksy)$/;
const pictograph = /\p{Extended_Pictographic}/u;

function trackedTextFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((path) => textExtensions.test(path) && path !== "package-lock.json");
}

describe("repository rules", () => {
  it("keeps emoji out of code and docs", () => {
    const offenders = trackedTextFiles().filter((path) => pictograph.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("keeps the README bilingual", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("## English");
    expect(readme).toContain("## 繁體中文");
  });
});
