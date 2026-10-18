import { describe, expect, it } from "vitest";
import { packageName } from "../src/index.js";

describe("package entry", () => {
  it("exports the package name", () => {
    expect(packageName).toBe("hexsleuth");
  });
});
