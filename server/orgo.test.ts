import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPUTER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SCREEN = Buffer.from("orgo-screenshot").toString("base64");

describe("Orgo provider adapter", () => {
  let server: Server;
  let dataDir: string;
  let provider: typeof import("./orgo.ts");
  let computer: Record<string, unknown> | null = null;
  const calls: Array<{ method: string; path: string; body: any; authorization?: string }> = [];
  const cfg = { orgo: { apiKey: "orgo-test-key", workspaceId: WORKSPACE_ID } };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "open-orgo-provider-"));
    server = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        const path = new URL(request.url ?? "/", "http://orgo.test").pathname;
        const body = raw ? JSON.parse(raw) : undefined;
        calls.push({ method: request.method ?? "GET", path, body, authorization: request.headers.authorization });
        const send = (status: number, value: unknown) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(value));
        };
        if (request.method === "GET" && path === "/api/workspaces") {
          return send(200, [{ id: WORKSPACE_ID, name: "Primary", status: "active", desktops: computer ? [computer] : [] }]);
        }
        if (request.method === "POST" && path === "/api/computers") {
          computer = {
            id: COMPUTER_ID,
            name: body.name,
            workspace_id: body.workspace_id,
            status: "running",
            connection_url: "https://desktop.orgo.test",
            vnc_password: "temporary-password",
          };
          return send(200, computer);
        }
        if (path === `/api/computers/${COMPUTER_ID}` && request.method === "GET") {
          return computer ? send(200, computer) : send(404, { error: "not found" });
        }
        if (path === `/api/computers/${COMPUTER_ID}/start` && request.method === "POST") {
          if (computer) computer.status = "running";
          return send(200, { success: true });
        }
        if (path === `/api/computers/${COMPUTER_ID}/stop` && request.method === "POST") {
          if (computer) computer.status = "stopped";
          return send(200, { success: true });
        }
        if (path === `/api/computers/${COMPUTER_ID}/screenshot` && request.method === "GET") {
          return send(200, { image: `data:image/jpeg;base64,${SCREEN}` });
        }
        if (path === `/api/computers/${COMPUTER_ID}/bash` && request.method === "POST") {
          return send(200, { success: true, output: "command complete\n" });
        }
        if (path === `/api/computers/${COMPUTER_ID}` && request.method === "DELETE") {
          computer = null;
          return send(200, { success: true });
        }
        return send(404, { error: "unknown route" });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fake Orgo API did not bind");
    process.env.OOB_DATA_DIR = dataDir;
    process.env.OOB_ORGO_API = `http://127.0.0.1:${address.port}/api`;
    vi.resetModules();
    provider = await import("./orgo.ts");
  });

  afterAll(() => {
    server?.close();
    delete process.env.OOB_DATA_DIR;
    delete process.env.OOB_ORGO_API;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("verifies the selected workspace and creates the pinned Linux desktop", async () => {
    await expect(provider.verifyApiKey(cfg.orgo.apiKey, WORKSPACE_ID)).resolves.toEqual({ ok: true });
    const created = await provider.provisionOrgo(cfg, "bot-1", "Hermes");
    expect(created).toMatchObject({ computerId: COMPUTER_ID, state: "running", reused: false });
    expect(created.joinUrl).toContain("http://127.0.0.1:8799/orgo-viewer#");
    expect(decodeURIComponent(created.joinUrl)).toContain("https://desktop.orgo.test");
    const create = calls.find((call) => call.method === "POST" && call.path === "/api/computers");
    expect(create).toMatchObject({
      authorization: "Bearer orgo-test-key",
      body: { workspace_id: WORKSPACE_ID, os: "linux", ram: 4, cpu: 1, disk_size_gb: 8, resolution: "1280x720x24" },
    });
  });

  it("maps screenshot, shell, stop, start, inventory and deletion", async () => {
    await expect(provider.screenshotOrgo(cfg, "bot-1", COMPUTER_ID)).resolves.toEqual({ png: SCREEN, format: "jpeg" });
    await expect(provider.runCommand(cfg, COMPUTER_ID, "printf ok")).resolves.toMatchObject({ ok: true, stdout: "command complete\n" });
    await expect(provider.sleepOrgo(cfg, "bot-1")).resolves.toEqual({ ok: true });
    await expect(provider.readyOrgo(cfg, "bot-1")).resolves.toMatchObject({ id: COMPUTER_ID, status: "running" });

    const inventory = await provider.listManagedOrgos(cfg, [{ botId: "bot-1", name: "Hermes", inUse: false }]);
    expect(inventory).toMatchObject({ available: true, instances: [{ computerId: COMPUTER_ID, ownerBotId: "bot-1" }] });
    await expect(provider.deleteManagedOrgo(cfg, [{ botId: "bot-1", name: "Hermes", inUse: false }], COMPUTER_ID, inventory.instances[0].name)).resolves.toEqual({ ok: true });
    await expect(provider.inspectOrgoIdentity(cfg, COMPUTER_ID)).resolves.toMatchObject({ available: true, identity: null });
  });
});

describe("Orgo provider errors", () => {
  it("distinguishes a rejected credential from plan and capacity failures", async () => {
    const { orgoErrorMessage } = await import("./orgo.ts");
    expect(orgoErrorMessage(401, "computer creation", { message: "Unauthorized" })).toContain("API key was rejected");
    expect(orgoErrorMessage(403, "computer creation", { code: "UPGRADE_REQUIRED", message: "Upgrade your plan" }))
      .toContain("current plan or capacity");
    expect(orgoErrorMessage(403, "computer creation", { detail: { code: "VM_SLOT_ADDON", message: "No slots" } }))
      .toContain("current plan or capacity");
    expect(orgoErrorMessage(403, "computer creation", { code: "WORKSPACE_SCOPE_MISMATCH" }))
      .toContain("selected Orgo workspace");
    expect(orgoErrorMessage(403, "computer creation", { message: "Forbidden" })).toContain("account permissions");
  });
});
