import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROXY = join(dirname(fileURLToPath(import.meta.url)), "computer-proxy.ts");
const COMPUTER_ID = "11111111-1111-4111-8111-111111111111";
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(700, 0x20),
  Buffer.from([0xff, 0xd9]),
]).toString("base64");

describe("computer proxy against the Orgo API", () => {
  let api: Server;
  let proxy: ChildProcess;
  const calls: Array<{ method: string; path: string; body: any; authorization?: string }> = [];
  const results = new Map<number, any>();

  const rpc = (message: unknown) => proxy.stdin!.write(`${JSON.stringify(message)}\n`);
  const waitFor = async (id: number, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (results.has(id)) return results.get(id);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no MCP response for ${id}`);
  };

  beforeAll(async () => {
    api = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        const path = new URL(request.url ?? "/", "http://orgo.test").pathname;
        const body = raw ? JSON.parse(raw) : undefined;
        calls.push({ method: request.method ?? "GET", path, body, authorization: request.headers.authorization });
        response.writeHead(200, { "content-type": "application/json" });
        if (path.endsWith("/screenshot")) {
          response.end(JSON.stringify({ image: `data:image/jpeg;base64,${JPEG}` }));
        } else if (path.endsWith("/bash")) {
          response.end(JSON.stringify({ success: true, output: "hello from Orgo\n" }));
        } else {
          response.end(JSON.stringify({ success: true }));
        }
      });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const address = api.address();
    if (!address || typeof address === "string") throw new Error("fake Orgo API did not bind");

    proxy = spawn(process.execPath, ["--experimental-strip-types", PROXY], {
      env: {
        ...process.env,
        OOB_ORGO_API: `http://127.0.0.1:${address.port}`,
        OOB_ORGO_COMPUTER_ID: COMPUTER_ID,
        OOB_ORGO_API_KEY: "orgo-test-key",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    proxy.stdout!.on("data", (chunk) => {
      output += chunk;
      let newline = output.indexOf("\n");
      while (newline >= 0) {
        const line = output.slice(0, newline);
        output = output.slice(newline + 1);
        if (line.trim()) {
          const message = JSON.parse(line);
          if (message.id !== undefined) results.set(message.id, message);
        }
        newline = output.indexOf("\n");
      }
    });
    rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    await waitFor(1);
  });

  afterAll(() => {
    proxy?.kill();
    api?.close();
  });

  it("exposes the unchanged computer MCP surface", async () => {
    rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = (await waitFor(2)).result.tools.map((tool: any) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "screenshot", "click", "type_text", "press_key", "scroll", "computer_batch", "computer_exec",
    ]));
  });

  it("uses Orgo's native screenshot and input endpoints with bearer auth", async () => {
    rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "screenshot", arguments: {} } });
    const screenshot = await waitFor(3);
    expect(screenshot.result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", mimeType: "image/jpeg", data: JPEG }),
    ]));

    rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "click", arguments: { x: 120, y: 240, observe: false } } });
    expect((await waitFor(4)).result.isError).toBeUndefined();
    const click = calls.find((call) => call.path.endsWith("/click"));
    expect(click).toMatchObject({
      method: "POST",
      path: `/computers/${COMPUTER_ID}/click`,
      body: { x: 120, y: 240, button: "left", double: false },
      authorization: "Bearer orgo-test-key",
    });
  });

  it("runs shell commands through the assigned Orgo computer", async () => {
    rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "computer_exec", arguments: { command: "printf hello" } },
    });
    const result = await waitFor(5);
    expect(result.result.content[0].text).toContain("hello from Orgo");
    const shell = calls.find((call) => call.path.endsWith("/bash"));
    expect(shell?.authorization).toBe("Bearer orgo-test-key");
    expect(shell?.body.command).toContain("printf hello");
  });
});
