// First-party bridge to an installed Super Browser bundle. The bundle stays
// outside Open Orgo Bot: its private/source distribution policy is separate,
// while this adapter discovers and verifies it before exposing its MCP server
// to an agent. Orgo credentials are withheld unless this turn already owns a
// verified app-managed computer, which prevents Super Browser's fallback
// adapter from discovering or creating a second billable machine.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const PLUGIN_NAME = "super-browser";
export const SUPER_BROWSER_MCP_NAME = "super_browser";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MANIFEST_FILE = "super-browser-manifest.json";
const PLUGIN_FILE = ".codex-plugin/plugin.json";
const ENTRYPOINT = "mcp/super-browser-server";

type SuperBrowserSource = "override" | "bundled" | "codex" | "agents";

interface ManifestEntry {
  path: string;
  bytes: number;
  executable: boolean;
  sha256: string;
}

interface BundleManifest {
  schema_version?: unknown;
  plugin?: unknown;
  files?: unknown;
}

export interface SuperBrowserStatus {
  available: boolean;
  version?: string;
  source?: SuperBrowserSource;
  verified?: boolean;
  reason?: string;
}

export interface SuperBrowserInstallation extends SuperBrowserStatus {
  root?: string;
  entrypoint?: string;
}

export interface SuperBrowserMcpServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface SuperBrowserDiscoveryOptions {
  env?: Record<string, string | undefined>;
  home?: string;
  platform?: NodeJS.Platform;
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.includes("\0") || value.includes("\\")) return false;
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Reject symlinks at every bundle-owned path segment. An installed bundle
 * may be replaced atomically between app launches, but it cannot redirect a
 * verified entrypoint or Python module elsewhere at launch time. */
function assertNoSymlinks(root: string, target: string): void {
  if (!inside(root, target)) throw new Error("bundle path escapes its root");
  let cursor = root;
  if (lstatSync(cursor).isSymbolicLink()) throw new Error("bundle root is a symbolic link");
  const rel = relative(root, target);
  if (!rel) return;
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("bundle contains a symbolic link");
  }
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function manifestEntries(value: BundleManifest): ManifestEntry[] {
  if (value.schema_version !== 1 || value.plugin !== PLUGIN_NAME || !Array.isArray(value.files)) {
    throw new Error("bundle manifest is not a supported Super Browser manifest");
  }
  return value.files.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`bundle manifest entry ${index} is invalid`);
    const item = raw as Record<string, unknown>;
    if (!safeRelativePath(item.path) || !Number.isSafeInteger(item.bytes) || Number(item.bytes) < 0 ||
        typeof item.executable !== "boolean" || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) {
      throw new Error(`bundle manifest entry ${index} is invalid`);
    }
    return { path: item.path, bytes: Number(item.bytes), executable: item.executable, sha256: item.sha256 };
  });
}

function isRuntimePath(path: string): boolean {
  return path === PLUGIN_FILE || path === ".mcp.json" || path === "README.md" || path === "SKILL.md" ||
    path.startsWith("mcp/") || path.startsWith("src/super_browser/") || path.startsWith("references/") ||
    path.startsWith("docs/") || path.startsWith("skills/");
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function inspectSuperBrowserRoot(rootInput: string, source: SuperBrowserSource = "override", platform: NodeJS.Platform = process.platform): SuperBrowserInstallation {
  if (platform === "win32") return { available: false, source, reason: "Super Browser's installed MCP launcher currently requires macOS or Linux." };
  const root = resolve(rootInput);
  try {
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error("bundle directory is missing");
    const manifestPath = join(root, MANIFEST_FILE);
    const pluginPath = join(root, PLUGIN_FILE);
    const entrypoint = join(root, ENTRYPOINT);
    for (const file of [manifestPath, pluginPath, entrypoint]) {
      if (!existsSync(file)) throw new Error(`${relative(root, file)} is missing`);
      assertNoSymlinks(root, file);
    }

    const plugin = readJson(pluginPath) as Record<string, unknown>;
    if (plugin.name !== PLUGIN_NAME || typeof plugin.version !== "string" || !VERSION.test(plugin.version) || plugin.license !== "MIT") {
      throw new Error("plugin metadata is invalid");
    }

    const entries = manifestEntries(readJson(manifestPath) as BundleManifest).filter((entry) => isRuntimePath(entry.path));
    if (!entries.some((entry) => entry.path === ENTRYPOINT) || !entries.some((entry) => entry.path === "src/super_browser/mcp_server.py")) {
      throw new Error("bundle manifest does not cover the MCP runtime");
    }
    for (const entry of entries) {
      const file = resolve(root, entry.path);
      if (!inside(root, file) || !existsSync(file)) throw new Error(`${entry.path} is missing`);
      assertNoSymlinks(root, file);
      const stat = statSync(file);
      if (!stat.isFile() || stat.size !== entry.bytes || sha256(file) !== entry.sha256) throw new Error(`${entry.path} failed bundle verification`);
      if (entry.executable && (stat.mode & 0o111) === 0) throw new Error(`${entry.path} is not executable`);
    }
    return { available: true, verified: true, version: plugin.version, source, root, entrypoint };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { available: false, source, reason: `Super Browser is installed but cannot be used safely: ${detail}.` };
  }
}

function candidateRoots(options: SuperBrowserDiscoveryOptions): Array<{ root: string; source: SuperBrowserSource; explicit: boolean }> {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const candidates: Array<{ root: string; source: SuperBrowserSource; explicit: boolean }> = [];
  if (env.OOB_SUPER_BROWSER_ROOT?.trim()) candidates.push({ root: env.OOB_SUPER_BROWSER_ROOT.trim(), source: "override", explicit: true });
  if (env.OMB_RESOURCES_PATH?.trim()) candidates.push({ root: join(env.OMB_RESOURCES_PATH.trim(), "super-browser"), source: "bundled", explicit: false });
  candidates.push(
    { root: join(home, ".codex", "skills", "super-browser"), source: "codex", explicit: false },
    { root: join(home, ".agents", "skills", "super-browser"), source: "agents", explicit: false },
  );
  return candidates;
}

export function discoverSuperBrowser(options: SuperBrowserDiscoveryOptions = {}): SuperBrowserInstallation {
  const platform = options.platform ?? process.platform;
  let invalid: SuperBrowserInstallation | null = null;
  for (const candidate of candidateRoots(options)) {
    if (!existsSync(candidate.root)) continue;
    const inspected = inspectSuperBrowserRoot(candidate.root, candidate.source, platform);
    if (inspected.available) return inspected;
    if (candidate.explicit) return inspected;
    invalid ??= inspected;
  }
  return invalid ?? { available: false, reason: "Install the Super Browser bundle to enable its verified routing tools." };
}

export function superBrowserSummary(options: SuperBrowserDiscoveryOptions = {}): SuperBrowserStatus {
  const { root: _root, entrypoint: _entrypoint, ...status } = discoverSuperBrowser(options);
  return status;
}

export function superBrowserMcpServer(options: {
  installation?: SuperBrowserInstallation;
  dataDir: string;
  path: string;
  orgo?: { computerId?: string; apiKey?: string };
}): SuperBrowserMcpServer | null {
  const installation = options.installation ?? discoverSuperBrowser();
  if (!installation.available || !installation.root || !installation.entrypoint) return null;
  const env: Record<string, string> = {
    PATH: options.path,
    SUPER_BROWSER_REPO_ROOT: installation.root,
    SUPER_BROWSER_STATE_DIR: join(options.dataDir, "super-browser"),
  };
  // Both values are required as a pair. Without the pin, the upstream Orgo
  // adapter is intentionally left unconfigured because it may create a new
  // paid computer as a fallback.
  if (UUID.test(options.orgo?.computerId ?? "") && options.orgo?.apiKey?.trim()) {
    env.ORGO_COMPUTER_ID = options.orgo!.computerId!;
    env.ORGO_API_KEY = options.orgo!.apiKey!.trim();
  }
  return { command: installation.entrypoint, args: [], env };
}

export function mergeSuperBrowserMcp(
  custom: Record<string, SuperBrowserMcpServer> | undefined,
  server: SuperBrowserMcpServer | null,
): Record<string, SuperBrowserMcpServer> | undefined {
  if (!server) return custom;
  return { ...custom, [SUPER_BROWSER_MCP_NAME]: server };
}

/** Keep the built-in name out of the “user-added MCP” sentence. */
export function userMcpNames(custom: Record<string, unknown> | undefined): string[] {
  return Object.keys(custom ?? {}).filter((name) => name !== SUPER_BROWSER_MCP_NAME);
}
