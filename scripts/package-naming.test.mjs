import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const builderConfig = parse(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8"));

describe("desktop package naming", () => {
  it("keeps the macOS product and helper bundle names aligned", () => {
    expect(builderConfig.productName).toBe("Open Orgo Bot");
    expect(builderConfig.mac.executableName).toBe(builderConfig.productName);
  });

  it("isolates the compact Linux install path to Linux package commands", () => {
    for (const scriptName of ["package:linux", "package:linux:offline", "package:linux:dir"]) {
      expect(packageJson.scripts[scriptName]).toContain("--config.productName=OpenOrgoBot");
    }
    expect(packageJson.scripts["package:mac"]).not.toContain("--config.productName");
    expect(packageJson.scripts["package:win"]).not.toContain("--config.productName");
  });
});
