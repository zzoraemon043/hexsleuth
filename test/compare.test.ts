import { describe, expect, it } from "vitest";
import { compareTool } from "../src/tools/compare.js";
import { runTool } from "../src/tools/definition.js";
import { fixtureManifest, fixturePaths } from "./helpers.js";

describe("compare", () => {
  it("finds the constant PNG signature and the constant IEND trailer", async () => {
    const output = await runTool(compareTool, { files: fixturePaths("png") });
    expect(output.fromStart.regions[0]).toMatchObject({ kind: "constant", offset: 0 });
    expect(output.fromStart.regions[0]?.length).toBeGreaterThanOrEqual(16);
    expect(output.fromStart.regions[0]?.bytes?.startsWith("89 50 4e 47 0d 0a 1a 0a")).toBe(true);
    expect(output.fromEnd.regions[0]).toEqual({ kind: "constant", offset: 0, length: 12, bytes: "00 00 00 00 49 45 4e 44 ae 42 60 82" });
  });

  it("reports variable regions with per-sample values", async () => {
    const files = fixturePaths("hxsf");
    const output = await runTool(compareTool, { files });
    const versionRegion = output.fromStart.regions.find((region) => region.offset === 4);
    expect(versionRegion?.kind).toBe("variable");
    expect(versionRegion?.values).toEqual(["01", "02", "01", "02", "01", "02"]);
    expect(output.fromStart.constantBytes + output.fromStart.variableBytes).toBe(output.sizes.min);
  });

  it("reports the region whose length tracks the file size", async () => {
    const files = fixturePaths("wav");
    const output = await runTool(compareTool, { files });
    const [tracking] = output.sizeTracking;
    expect(tracking?.offset).toBe(22);
    expect(tracking?.endOffsetFromEnd).toBe(0);
    const sizes = fixtureManifest().wav?.map((file) => file.size) ?? [];
    expect(tracking?.lengths.map((entry) => entry.length)).toEqual(sizes.map((size) => size - 22));
    expect(tracking?.check).toBe("length equals file size minus 22 in 6 of 6 samples, with a constant header ending at 22 and a constant trailer of 0 bytes");
  });

  it("merges short coincidental constants when asked", async () => {
    const files = fixturePaths("png");
    const exact = await runTool(compareTool, { files, maxRegions: 10000 });
    const merged = await runTool(compareTool, { files, maxRegions: 10000, minConstantLength: 4 });
    expect(merged.fromStart.regions.length).toBeLessThan(exact.fromStart.regions.length);
    expect(merged.fromStart.regions.every((region, index, all) => index === 0 || index === all.length - 1 || region.kind === "variable" || region.length >= 4)).toBe(true);
  });

  it("warns when only two samples are compared", async () => {
    const output = await runTool(compareTool, { files: fixturePaths("zip").slice(0, 2) });
    expect(output.notes.some((note) => note.includes("two samples"))).toBe(true);
  });

  it("requires at least two files", async () => {
    await expect(runTool(compareTool, { files: fixturePaths("zip").slice(0, 1) })).rejects.toThrow();
  });
});
