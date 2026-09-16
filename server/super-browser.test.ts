import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverSuperBrowser,
  inspectSuperBrowserRoot,
  mergeSuperBrowserMcp,
  superBrowserMcpServer,
  superBrowserSummary,
  userMcpNames,
} from "./super-browser.ts";

const roots: string[] = [];

function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "open-orgo-super-browser-"));
  roots.push(root);
  mkdirSync(join(root, ".codex-plugin"), { recursive: true });
  mkdirSync(join(root, "mcp"), { recursive: true });
  mkdirSync(join(root, "src", "super_browser"), { recursive: true });
  writeFileSync(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "super-browser", version: "0.3.2", license: "MIT" }));
  writeFileSync(join(root, "mcp", "super-browser-server"), "#!/bin/sh\nexec python3 -m super_browser.mcp_server\n");
  chmodSync(join(root, "mcp", "super-browser-server"), 0o755);
  writeFileSync(join(root, "src", "super_browser", "mcp_server.py"), "print('fixture')\n");
  const paths = [
    ".codex-plugin/plugin.json",
    "mcp/super-browser-server",
    "src/super_browser/mcp_server.py",
  ];
  const files = paths.map((path) => {
    const file = join(root, path);
    const stat = statSync(file);
    return { path, bytes: stat.size, executable: (stat.mode & 0o111) !== 0, sha256: digest(file) };
  });
  writeFileSync(join(root, "super-browser-manifest.json"), JSON.stringify({ schema_version: 1, plugin: "super-browser", files }));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Super Browser bridge", () => {
  it("verifies an installed bundle and exposes only non-secret status", () => {
    const root = fixture();
    expect(inspectSuperBrowserRoot(root)).toMatchObject({ available: true, verified: true, version: "0.3.2", source: "override" });
    expect(superBrowserSummary({ env: { OOB_SUPER_BROWSER_ROOT: root }, home: join(root, "empty") })).toEqual({
      available: true,
      verified: true,
      version: "0.3.2",
      source: "override",
    });
  });

  it("fails closed when a manifest-covered runtime file changes or redirects through a symlink", () => {
    const root = fixture();
    writeFileSync(join(root, "src", "super_browser", "mcp_server.py"), "print('tampered')\n");
    expect(inspectSuperBrowserRoot(root)).toMatchObject({ available: false, reason: expect.stringMatching(/failed bundle verification/) });

    const linked = fixture();
    const entrypoint = join(linked, "mcp", "super-browser-server");
    rmSync(entrypoint);
    symlinkSync("/bin/echo", entrypoint);
    expect(inspectSuperBrowserRoot(linked)).toMatchObject({ available: false, reason: expect.stringMatching(/symbolic link/) });
  });

  it("treats an explicit invalid root as authoritative", () => {
    const bad = mkdtempSync(join(tmpdir(), "open-orgo-super-browser-bad-"));
    roots.push(bad);
    const goodHome = mkdtempSync(join(tmpdir(), "open-orgo-super-browser-home-"));
    roots.push(goodHome);
    const installed = fixture();
    mkdirSync(join(goodHome, ".codex", "skills"), { recursive: true });
    symlinkSync(installed, join(goodHome, ".codex", "skills", "super-browser"));
    expect(discoverSuperBrowser({ env: { OOB_SUPER_BROWSER_ROOT: bad }, home: goodHome })).toMatchObject({ available: false, source: "override" });
  });

  it("pins Super Browser to the already-managed Orgo and never supplies an unpinned key", () => {
    const root = fixture();
    const installation = inspectSuperBrowserRoot(root);
    const pinned = superBrowserMcpServer({
      installation,
      dataDir: join(root, "data"),
      path: "/safe/bin",
      orgo: { computerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", apiKey: "fixture-secret" },
    });
    expect(pinned).toMatchObject({
      command: join(root, "mcp", "super-browser-server"),
      args: [],
      env: {
        PATH: "/safe/bin",
        SUPER_BROWSER_REPO_ROOT: root,
        SUPER_BROWSER_STATE_DIR: join(root, "data", "super-browser"),
        ORGO_COMPUTER_ID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ORGO_API_KEY: "fixture-secret",
      },
    });
    const unpinned = superBrowserMcpServer({ installation, dataDir: join(root, "data"), path: "/safe/bin", orgo: { apiKey: "fixture-secret" } });
    expect(unpinned?.env).not.toHaveProperty("ORGO_API_KEY");
    expect(unpinned?.env).not.toHaveProperty("ORGO_COMPUTER_ID");
  });

  it("reserves its built-in name without changing user MCP labels", () => {
    const server = { command: "fixture", args: [], env: {} };
    expect(mergeSuperBrowserMcp({ notes: server }, server)).toEqual({ notes: server, super_browser: server });
    expect(userMcpNames({ notes: server, super_browser: server })).toEqual(["notes"]);
  });
});
