import { augmentedPath } from "./env-path.ts";
import {
  PROVIDER_CREDENTIAL_ENV,
  stripWorkspaceCredentialEnv,
} from "./config.ts";
import { createLineSplitter } from "./mcp-bridge.ts";
import { McpHttpError, RemoteMcpClient } from "./mcp-http.ts";
import { isRemoteMcpServer, type StoredMcpServer, type StoredRemoteMcpServer, type StoredStdioMcpServer } from "./mcp-registry.ts";
import { killCliTree, spawnCli } from "./procs.ts";

export interface McpProbeTool {
  name: string;
  description?: string;
}

export type McpProbeResult =
  | { ok: true; tools: McpProbeTool[] }
  | { ok: false; error: string };
export type McpToolCallResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

const MAX_STDOUT_BYTES = 1_048_576;
const MAX_TOOLS = 100;
const DEFAULT_TIMEOUT_MS = 8_000;

function probeEnvironment(server: StoredStdioMcpServer): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: augmentedPath() };
  stripWorkspaceCredentialEnv(env);
  for (const key of PROVIDER_CREDENTIAL_ENV) delete env[key];
  // Built-in and custom MCP checks never inherit ambient browser-provider
  // identities. A caller must pass each credential explicitly in server.env;
  // in particular, ORGO_COMPUTER_ID must stay paired with ORGO_API_KEY.
  for (const key of [
    "AIRTOP_API_KEY", "AIRTOP_API_BASE", "AIRTOP_TIMEOUT_MINUTES", "BROWSER_USE_API_KEY",
    "BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID", "DECODO_PROXY", "HYPERBROWSER_API_KEY",
    "HYPERBROWSER_API_BASE", "ORGO_API_KEY", "ORGO_API_BASE", "ORGO_COMPUTER_ID", "ORGO_MODEL",
    "STEEL_API_KEY", "STEEL_CDP_URL",
  ]) delete env[key];
  Object.assign(env, server.env);
  return env;
}

function publicProbeError(kind: "spawn" | "timeout" | "protocol" | "closed" | "cancelled"): string {
  if (kind === "spawn") return "Could not start this command. Check that it is installed and executable.";
  if (kind === "timeout") return "The server did not answer in time.";
  if (kind === "closed") return "The server stopped before the MCP handshake finished.";
  if (kind === "cancelled") return "Connection test was cancelled.";
  return "The command did not return a valid MCP tools list.";
}

function redactConfiguredValues(value: string, secrets: Record<string, string>): string {
  let redacted = value;
  for (const secret of Object.values(secrets)) {
    if (secret) redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

function redactToolResult(value: unknown, env: Record<string, string>, key = "", depth = 0): unknown {
  if (depth > 12) return "[truncated]";
  if (typeof value === "string") {
    if (/(?:^|_)(?:secret|password|token|api_?key|credential|authorization)(?:$|_)/i.test(key) && !/(?:name|env|missing|required)/i.test(key)) {
      return "[redacted]";
    }
    return redactConfiguredValues(value, env).slice(0, 20_000);
  }
  if (Array.isArray(value)) return value.slice(0, 200).map(item => redactToolResult(item, env, key, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 200)
    .map(([childKey, child]) => [childKey, redactToolResult(child, env, childKey, depth + 1)]));
}

/** Call one named tool on a short-lived stdio MCP server. The child receives
 * only the explicitly supplied provider credentials, is bounded and reaped,
 * and its structured response is recursively redacted before it leaves the
 * server process. */
export function callMcpTool(
  server: StoredStdioMcpServer,
  name: string,
  args: Record<string, unknown> = {},
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<McpToolCallResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ ok: false, error: publicProbeError("cancelled") });
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(server.command, server.args, { cwd: process.cwd(), env: probeEnvironment(server), stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      return resolve({ ok: false, error: publicProbeError("spawn") });
    }
    let settled = false;
    let initialized = false;
    let stdoutBytes = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish({ ok: false, error: publicProbeError("cancelled") });
    const finish = (result: McpToolCallResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      killCliTree(child);
      resolve(result);
    };
    const write = (frame: unknown) => {
      try { child.stdin.write(`${JSON.stringify(frame)}\n`); }
      catch { finish({ ok: false, error: publicProbeError("closed") }); }
    };
    const splitter = createLineSplitter((line) => {
      if (settled || !line.trim()) return;
      let frame: unknown;
      try { frame = JSON.parse(line); } catch { return; }
      if (!frame || typeof frame !== "object") return;
      const value = frame as Record<string, unknown>;
      if (value.id === 1 && value.result && !initialized) {
        initialized = true;
        write({ jsonrpc: "2.0", method: "notifications/initialized" });
        write({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
        return;
      }
      if (value.id !== 2) return;
      if (value.error) return finish({ ok: false, error: publicProbeError("protocol") });
      const result = value.result as Record<string, unknown> | undefined;
      if (!result || result.isError === true) {
        const structured = result?.structuredContent as Record<string, unknown> | undefined;
        const message = typeof structured?.error === "string" ? redactConfiguredValues(structured.error, server.env).slice(0, 1_000) : publicProbeError("protocol");
        return finish({ ok: false, error: message });
      }
      finish({ ok: true, result: redactToolResult(result.structuredContent ?? result, server.env) });
    });
    timer = setTimeout(() => finish({ ok: false, error: publicProbeError("timeout") }), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) return finish({ ok: false, error: publicProbeError("protocol") });
      splitter.push(chunk);
    });
    child.stderr.resume();
    child.once("error", () => finish({ ok: false, error: publicProbeError("spawn") }));
    child.once("close", () => finish({ ok: false, error: publicProbeError("closed") }));
    write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Open Orgo Bot", version: "check" } } });
  });
}

/** Start one stdio server long enough to prove the MCP handshake and list its
 * tools. It is always reaped, never inherits Open Orgo Bot credentials, and never
 * returns child stderr or environment values to the renderer. */

/** The bounded, redacted tool list the renderer may see. `secrets` are the
 * configured values (env or header values) a careless server might echo. */
function publicTools(raw: unknown[], secrets: Record<string, string>): McpProbeTool[] {
  const tools: McpProbeTool[] = [];
  for (const entry of raw.slice(0, MAX_TOOLS)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.name !== "string" || !candidate.name.trim()) continue;
    tools.push({
      name: redactConfiguredValues(candidate.name, secrets).slice(0, 200),
      ...(typeof candidate.description === "string"
        ? { description: redactConfiguredValues(candidate.description, secrets).slice(0, 500) }
        : {}),
    });
  }
  return tools;
}

/** Prove the MCP handshake and list the tools of one configured server,
 * whichever way it is reached. Neither path returns anything the renderer
 * must not see: child stderr, environment values, header values. */
export function probeMcpServer(
  server: StoredMcpServer,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<McpProbeResult> {
  return isRemoteMcpServer(server)
    ? probeRemoteMcpServer(server, timeoutMs, signal)
    : probeStdioMcpServer(server, timeoutMs, signal);
}

/** Connect to a remote server over its transport, bounded by the same
 * timeout as a command. HTTP status codes are safe to show and are the one
 * detail that tells a wrong token from a wrong address. */
async function probeRemoteMcpServer(
  server: StoredRemoteMcpServer,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<McpProbeResult> {
  if (signal?.aborted) return { ok: false, error: publicProbeError("cancelled") };
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const client = new RemoteMcpClient(server);
  try {
    await client.initialize("Open Orgo Bot", combined);
    const result = await client.request("tools/list", {}, combined);
    const tools = result && typeof result === "object" ? (result as { tools?: unknown }).tools : undefined;
    if (!Array.isArray(tools)) return { ok: false, error: "The server did not return a valid MCP tools list." };
    return { ok: true, tools: publicTools(tools, server.headers) };
  } catch (error) {
    if (signal?.aborted) return { ok: false, error: publicProbeError("cancelled") };
    if (timeout.aborted) return { ok: false, error: publicProbeError("timeout") };
    if (error instanceof McpHttpError && error.kind === "status") {
      return { ok: false, error: `The server answered HTTP ${error.status}. Check the address and headers.` };
    }
    if (error instanceof McpHttpError && error.kind === "protocol") {
      return { ok: false, error: "The server did not return a valid MCP tools list." };
    }
    return { ok: false, error: "Could not reach this address. Check the URL and your network." };
  } finally {
    await client.close().catch(() => {});
  }
}

/** Start one stdio server long enough to prove the MCP handshake and list its
 * tools. It is always reaped, never inherits Open Orgo Bot credentials, and never
 * returns child stderr or environment values to the renderer. */
function probeStdioMcpServer(
  server: StoredStdioMcpServer,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<McpProbeResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, error: publicProbeError("cancelled") });
      return;
    }

    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(server.command, server.args, {
        cwd: process.cwd(),
        env: probeEnvironment(server),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve({ ok: false, error: publicProbeError("spawn") });
      return;
    }

    let settled = false;
    let stdoutBytes = 0;
    let initialized = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => finish({ ok: false, error: publicProbeError("cancelled") });
    const finish = (result: McpProbeResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      killCliTree(child);
      resolve(result);
    };
    const write = (frame: unknown) => {
      try {
        child.stdin.write(`${JSON.stringify(frame)}\n`);
      } catch {
        finish({ ok: false, error: publicProbeError("closed") });
      }
    };
    const splitter = createLineSplitter((line) => {
      if (settled || !line.trim()) return;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (!frame || typeof frame !== "object") return;
      const value = frame as Record<string, unknown>;
      if (value.id === 1 && value.result && !initialized) {
        initialized = true;
        write({ jsonrpc: "2.0", method: "notifications/initialized" });
        write({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        return;
      }
      if (value.id !== 2) return;
      const result = value.result as { tools?: unknown } | undefined;
      if (!Array.isArray(result?.tools)) {
        finish({ ok: false, error: publicProbeError("protocol") });
        return;
      }
      finish({ ok: true, tools: publicTools(result.tools, server.env) });
    });

    timer = setTimeout(() => {
      finish({ ok: false, error: publicProbeError("timeout") });
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        finish({ ok: false, error: publicProbeError("protocol") });
        return;
      }
      splitter.push(chunk);
    });
    // Drain without retaining it. Child stderr often contains secrets or
    // arbitrary native logs and is not part of the MCP protocol.
    child.stderr.resume();
    child.once("error", () => finish({ ok: false, error: publicProbeError("spawn") }));
    child.once("close", () => finish({ ok: false, error: publicProbeError("closed") }));

    if (signal?.aborted) {
      onAbort();
      return;
    }

    write({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Open Orgo Bot", version: "probe" },
      },
    });
  });
}
