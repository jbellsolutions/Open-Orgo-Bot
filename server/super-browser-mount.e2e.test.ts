import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

function bundleFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "open-orgo-super-browser-mount-"));
  mkdirSync(join(root, ".codex-plugin"), { recursive: true });
  mkdirSync(join(root, "mcp"), { recursive: true });
  mkdirSync(join(root, "src", "super_browser"), { recursive: true });
  writeFileSync(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "super-browser", version: "0.3.2", license: "MIT" }));
  writeFileSync(join(root, "mcp", "super-browser-server"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(root, "mcp", "super-browser-server"), 0o755);
  writeFileSync(join(root, "src", "super_browser", "mcp_server.py"), "# fixture\n");
  const paths = [".codex-plugin/plugin.json", "mcp/super-browser-server", "src/super_browser/mcp_server.py"];
  const files = paths.map((path) => {
    const file = join(root, path);
    const stat = statSync(file);
    return {
      path,
      bytes: stat.size,
      executable: (stat.mode & 0o111) !== 0,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    };
  });
  writeFileSync(join(root, "super-browser-manifest.json"), JSON.stringify({ schema_version: 1, plugin: "super-browser", files }));
  return root;
}

it.skipIf(process.platform === "win32")("mounts the verified Super Browser router without handing it an unpinned Orgo key", async () => {
  const bundle = bundleFixture();
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_MODE: "happy",
  }, undefined, undefined, undefined, undefined, undefined, [], undefined, bundle);
  try {
    const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
    const config = await fetch(`${fixture.info.url}/api/config`).then((response) => response.json()) as Record<string, unknown>;
    expect(config.superBrowser).toEqual({ available: true, verified: true, version: "0.3.2", source: "override" });
    expect(JSON.stringify(config)).not.toContain(bundle);
    const { bot } = await control(["new-bot", "--name", "Super Browser fixture"]) as { bot: { id: string } };
    await control(["send", "--bot", bot.id, "--text", "Plan a browser research task."]);
    await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 15_000 }).toBe(true);
    const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as {
      systemPrompt: string;
      mcpConfig: { mcpServers: Record<string, { command: string; env: Record<string, string> }> };
    };
    expect(dump.mcpConfig.mcpServers.super_browser).toMatchObject({
      env: { OMB_GATE_NAME: "super_browser" },
    });
    const upstream = JSON.parse(dump.mcpConfig.mcpServers.super_browser.env.OMB_GATE_UPSTREAM) as {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    expect(upstream).toMatchObject({
      command: join(bundle, "mcp", "super-browser-server"),
      args: [],
      env: {
        SUPER_BROWSER_REPO_ROOT: bundle,
        SUPER_BROWSER_STATE_DIR: join(fixture.info.dataDir, "super-browser"),
      },
    });
    expect(upstream.env).not.toHaveProperty("ORGO_API_KEY");
    expect(upstream.env).not.toHaveProperty("ORGO_COMPUTER_ID");
    expect(dump.systemPrompt).toContain("Super Browser routing tools are mounted as super_browser");
    expect(dump.systemPrompt).not.toContain('MCP server for you: "super_browser"');
    expect((await control(["wait", "--bot", bot.id, "--timeout", "30"]) as { status: string }).status).toBe("settled");
  } finally {
    await fixture.close();
    rmSync(bundle, { recursive: true, force: true });
    expect(existsSync(fixture.info.dataDir)).toBe(false);
  }
}, 60_000);
