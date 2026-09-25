// Orgo provider — the bot's persistent cloud computer. This module keeps the
// original app's ownership and lifecycle boundary while using Orgo's public
// computer API for inventory, creation, desktop control and shell access.
import { createHash } from "node:crypto";

import { DATA_DIR, type AppConfig } from "./config.ts";
import { loadEnvironmentId } from "./environment.ts";
import {
  adoptResolvedOrgo,
  beginOrgoCreate,
  discardOrgoCreate,
  rememberCreatedOrgo,
  resolveOrgoCreate,
  retireDeletedOrgoCreate,
  type OrgoCreateRequest,
} from "./orgo-create-idempotency.ts";
import { isolatedRemoteCommand, MAX_REMOTE_COMMAND_LENGTH } from "./remote-computer.ts";

const ORGO_API = process.env.OOB_ORGO_API || "https://www.orgo.ai/api";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READY = new Set(["running"]);
const SLEEPING = new Set(["stopped", "suspended", "frozen"]);
const PENDING = new Set(["creating", "starting", "restarting", "updating", "stopping"]);
const RETRY_DELAYS_MS = [250, 750, 1_500] as const;

interface OrgoComputer {
  id: string;
  name: string;
  workspace_id?: string;
  workspace_name?: string;
  status: string;
  state: string;
  instance_id?: string;
  fly_instance_id?: string;
  connection_url?: string;
  vnc_password?: string;
  password?: string;
}

interface OrgoWorkspace {
  id: string;
  name: string;
  status?: string;
  desktops?: OrgoComputer[];
}

export interface ManagedOrgoOwner {
  botId: string;
  name: string;
  inUse: boolean;
  /** A user-selected existing Orgo computer. When present, identity is by
   * provider UUID rather than the app's legacy generated machine name. */
  computerId?: string;
}

export interface ManagedOrgoInventoryInstance {
  computerId: string;
  name: string;
  state: string;
  ownerBotId: string | null;
  ownerName: string | null;
  orphaned: boolean;
  inUse: boolean;
}

export interface ManagedOrgoInventory {
  configured: boolean;
  available: boolean;
  problem: string | null;
  instances: ManagedOrgoInventoryInstance[];
}

export interface AssignableOrgoInventoryInstance {
  computerId: string;
  name: string;
  workspaceId: string | null;
  workspaceName: string | null;
  state: string;
  ownerBotId: string | null;
  ownerName: string | null;
  available: boolean;
}

export interface AssignableOrgoInventory {
  configured: boolean;
  available: boolean;
  problem: string | null;
  instances: AssignableOrgoInventoryInstance[];
}

export interface OrgoIdentityInspection {
  available: boolean;
  identity: { computerId: string; name: string } | null;
  problem: string | null;
}

export type OrgoTurnLifecycleAction = "attach" | "provision" | "wake" | "none";
export type ManagedOrgoMutationClaim = (instance: ManagedOrgoInventoryInstance) => (() => void) | void;

let scopedPrefixCache: string | null = null;
const computerIdCache = new Map<string, string>();

function scopedPrefix(): string {
  if (scopedPrefixCache) return scopedPrefixCache;
  const scope = createHash("sha256").update(loadEnvironmentId(DATA_DIR)).digest("hex").slice(0, 12);
  scopedPrefixCache = `oob-${scope}-`;
  return scopedPrefixCache;
}

function botNameParts(botId: string): { prefix: string; hash: string } {
  const prefix = botId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "") || "bot";
  const hash = createHash("sha256").update(botId).digest("hex").slice(0, 6);
  return { prefix, hash };
}

export async function orgoNameFor(botId: string): Promise<string> {
  const { prefix, hash } = botNameParts(botId);
  return `${scopedPrefix()}${prefix}-${hash}`;
}

export async function orgoNameMatchesBot(botId: string, name: string): Promise<boolean> {
  return name === await orgoNameFor(botId);
}

function snapshotConfig(cfg: AppConfig): AppConfig {
  return { orgo: cfg.orgo ? { apiKey: cfg.orgo.apiKey, workspaceId: cfg.orgo.workspaceId } : undefined };
}

function headers(cfg: AppConfig): Record<string, string> {
  return { authorization: `Bearer ${cfg.orgo?.apiKey ?? ""}`, "content-type": "application/json" };
}

async function orgoJson(cfg: AppConfig, path: string, opts: RequestInit = {}, retry = true) {
  let lastError: unknown;
  const attempts = retry ? RETRY_DELAYS_MS.length + 1 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch(`${ORGO_API}${path}`, {
        ...opts,
        headers: { ...headers(cfg), ...opts.headers },
        signal: opts.signal ?? AbortSignal.timeout(30_000),
      });
      const body: any = await res.json().catch(() => null);
      if (res.status !== 429 || attempt === attempts - 1) return { ok: res.ok, status: res.status, body };
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt] ?? 1_500));
  }
  throw lastError;
}

function asComputer(value: any): OrgoComputer | null {
  const candidate = value?.computer ?? value?.data ?? value;
  if (!candidate || !UUID.test(candidate.id) || typeof candidate.name !== "string") return null;
  const status = typeof candidate.status === "string" ? candidate.status : "unknown";
  return { ...candidate, status, state: status };
}

function workspaceRows(body: any): OrgoWorkspace[] {
  const rows = Array.isArray(body) ? body : Array.isArray(body?.workspaces) ? body.workspaces : Array.isArray(body?.projects) ? body.projects : [];
  return rows.filter((row: any) => row && UUID.test(row.id) && typeof row.name === "string");
}

export async function listOrgoWorkspaces(cfg: AppConfig): Promise<Array<{ id: string; name: string; status: string }>> {
  cfg = snapshotConfig(cfg);
  if (!orgoConfigured(cfg)) return [];
  const result = await orgoJson(cfg, "/workspaces");
  if (!result.ok) throw Object.assign(new Error(orgoErrorMessage(result.status, "workspace listing", result.body)), { status: result.status });
  return workspaceRows(result.body).map((workspace) => ({ id: workspace.id, name: workspace.name, status: workspace.status ?? "unknown" }));
}

async function allComputers(cfg: AppConfig): Promise<OrgoComputer[]> {
  const result = await orgoJson(cfg, "/workspaces");
  if (!result.ok) throw Object.assign(new Error(orgoErrorMessage(result.status, "computer listing", result.body)), { status: result.status });
  return workspaceRows(result.body).flatMap((workspace) =>
    (Array.isArray(workspace.desktops) ? workspace.desktops : []).map((computer) => ({
      ...computer,
      workspace_id: computer.workspace_id ?? workspace.id,
      workspace_name: workspace.name,
    })),
  ).filter((computer) => UUID.test(computer.id) && typeof computer.name === "string");
}

async function workspaceId(cfg: AppConfig): Promise<string> {
  const configured = cfg.orgo?.workspaceId?.trim();
  const workspaces = await listOrgoWorkspaces(cfg);
  if (configured) {
    if (!UUID.test(configured)) throw new Error("the selected Orgo workspace ID is invalid");
    if (!workspaces.some((workspace) => workspace.id.toLowerCase() === configured.toLowerCase())) {
      throw new Error("the selected Orgo workspace is not accessible with this API key");
    }
    return configured;
  }
  const first = workspaces.find((workspace) => workspace.status === "active") ?? workspaces[0];
  if (!first) throw new Error("Orgo did not return a workspace for this account");
  return first.id;
}

export function orgoTurnLifecycleAction({ explicitCloud, canMount, state }: {
  explicitCloud: boolean;
  canMount: boolean;
  state: string | null;
}): OrgoTurnLifecycleAction {
  if (!canMount) return "none";
  if (state && READY.has(state)) return "attach";
  if (!explicitCloud) return "none";
  return state ? "wake" : "provision";
}

export function orgoConfigured(cfg: AppConfig): boolean {
  return Boolean(cfg.orgo?.apiKey?.trim());
}

export async function verifyApiKey(apiKey: string, selectedWorkspaceId?: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const cfg = { orgo: { apiKey, workspaceId: selectedWorkspaceId } } as AppConfig;
  try {
    const workspaces = await listOrgoWorkspaces(cfg);
    if (selectedWorkspaceId && !workspaces.some((workspace) => workspace.id.toLowerCase() === selectedWorkspaceId.toLowerCase())) {
      return { ok: false, message: "That Orgo workspace is not accessible with this API key." };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not reach Orgo." };
  }
}

export function orgoErrorMessage(status: number, what: string, body?: any): string {
  const detail = body?.detail && typeof body.detail === "object" ? body.detail : null;
  const code = [body?.code, body?.error_code, detail?.code, detail?.error_code]
    .find((value) => typeof value === "string")?.trim().toUpperCase() ?? "";
  const theirs = [body?.error, body?.message, typeof body?.detail === "string" ? body.detail : null, detail?.message, detail?.error]
    .find((value) => typeof value === "string")?.trim() ?? "";
  if (status === 401) return "your Orgo API key was rejected — reconnect Orgo in App Settings";
  if (status === 403) {
    // Orgo uses 403 for both authorization and account capacity. Treating
    // UPGRADE_REQUIRED as a bad credential sent people through an endless
    // reconnect loop even though workspace listing with that key succeeded.
    if (["UPGRADE_REQUIRED", "CHANGE_PLAN", "VM_SLOT_ADDON", "RAM_ADDON", "VCPU_ADDON"].includes(code) ||
        code.startsWith("PER_COMPUTER_") || /upgrade|plan|capacity|computer limit|slot|quota/i.test(theirs)) {
      return `Orgo cannot complete ${what} on the account's current plan or capacity — add computer capacity in Orgo, then retry`;
    }
    if (code === "WORKSPACE_SCOPE_MISMATCH" || /workspace.+(?:scope|access|permission)/i.test(theirs)) {
      return `the selected Orgo workspace does not allow ${what} — choose an accessible workspace in App Settings`;
    }
    return `Orgo denied ${what} for this account — check the selected workspace and account permissions`;
  }
  if (status === 404) return `${what} was not found in Orgo`;
  if (status === 429) return theirs || "Orgo is rate-limiting this account — wait a moment and retry";
  return theirs ? `${what} failed: ${theirs}` : `${what} failed (${status})`;
}

export async function runCommand(cfg: AppConfig, computerId: string, command: string, { timeoutMs = 120_000 } = {}) {
  if (!UUID.test(computerId)) throw new Error("invalid Orgo computer ID");
  if (command.length > MAX_REMOTE_COMMAND_LENGTH) throw new RangeError(`command is too long (maximum ${MAX_REMOTE_COMMAND_LENGTH} characters)`);
  const result = await orgoJson(snapshotConfig(cfg), `/computers/${computerId}/bash`, {
    method: "POST",
    body: JSON.stringify({ command }),
    signal: AbortSignal.timeout(timeoutMs),
  }, false);
  const output = typeof result.body?.output === "string" ? result.body.output : "";
  return { ok: result.ok && result.body?.success !== false, exitCode: result.ok && result.body?.success !== false ? 0 : 1, stdout: output, stderr: result.ok ? "" : orgoErrorMessage(result.status, "command", result.body) };
}

export async function listManagedOrgos(cfg: AppConfig, owners: ManagedOrgoOwner[]): Promise<ManagedOrgoInventory> {
  cfg = snapshotConfig(cfg);
  if (!orgoConfigured(cfg)) return { configured: false, available: true, problem: null, instances: [] };
  try {
    const computers = await allComputers(cfg);
    const expectedById = new Map(owners.filter((owner) => UUID.test(owner.computerId ?? "")).map((owner) => [owner.computerId!.toLowerCase(), owner]));
    const expectedByName = new Map<string, ManagedOrgoOwner>();
    for (const owner of owners) if (!owner.computerId) expectedByName.set(await orgoNameFor(owner.botId), owner);
    // Settings lifecycle actions only own app-created machines. A selected
    // external computer is usable by its agent but must never become eligible
    // for app deletion merely because it was assigned here.
    const instances = computers.filter((computer) => computer.name.startsWith(scopedPrefix())).map((computer) => {
      const owner = expectedById.get(computer.id.toLowerCase()) ?? expectedByName.get(computer.name) ?? null;
      if (owner) {
        computerIdCache.set(owner.botId, computer.id);
        adoptResolvedOrgo(owner.botId, computer.id);
      }
      return {
        computerId: computer.id,
        name: computer.name,
        state: computer.status,
        ownerBotId: owner?.botId ?? null,
        ownerName: owner?.name ?? null,
        orphaned: owner === null,
        inUse: owner?.inUse ?? false,
      };
    });
    return { configured: true, available: true, problem: null, instances };
  } catch (error) {
    return { configured: true, available: false, problem: error instanceof Error ? error.message : "Could not list Orgo computers", instances: [] };
  }
}

/** Every computer visible to the configured Orgo account, including machines
 * created outside this app. This is read-only inventory for the per-agent
 * picker; lifecycle deletion remains limited to app-owned machines. */
export async function listAssignableOrgos(cfg: AppConfig, owners: ManagedOrgoOwner[]): Promise<AssignableOrgoInventory> {
  cfg = snapshotConfig(cfg);
  if (!orgoConfigured(cfg)) return { configured: false, available: true, problem: null, instances: [] };
  try {
    const computers = await allComputers(cfg);
    const ownerById = new Map<string, ManagedOrgoOwner>();
    const ownerByName = new Map<string, ManagedOrgoOwner>();
    for (const owner of owners) {
      if (UUID.test(owner.computerId ?? "")) ownerById.set(owner.computerId!.toLowerCase(), owner);
      else ownerByName.set(await orgoNameFor(owner.botId), owner);
    }
    const instances = computers.map((computer) => {
      const owner = ownerById.get(computer.id.toLowerCase()) ?? ownerByName.get(computer.name) ?? null;
      return {
        computerId: computer.id,
        name: computer.name,
        workspaceId: computer.workspace_id ?? null,
        workspaceName: computer.workspace_name ?? null,
        state: computer.status,
        ownerBotId: owner?.botId ?? null,
        ownerName: owner?.name ?? null,
        available: owner === null,
      };
    });
    return { configured: true, available: true, problem: null, instances };
  } catch (error) {
    return { configured: true, available: false, problem: error instanceof Error ? error.message : "Could not list Orgo computers", instances: [] };
  }
}

export async function inspectOrgoIdentity(cfg: AppConfig, computerId: string): Promise<OrgoIdentityInspection> {
  if (!UUID.test(computerId)) return { available: true, identity: null, problem: null };
  try {
    const result = await orgoJson(snapshotConfig(cfg), `/computers/${computerId}`);
    if (result.status === 404 || result.status === 410) return { available: true, identity: null, problem: null };
    if (!result.ok) return { available: false, identity: null, problem: orgoErrorMessage(result.status, "computer inspection", result.body) };
    const computer = asComputer(result.body);
    return computer
      ? { available: true, identity: { computerId: computer.id, name: computer.name }, problem: null }
      : { available: false, identity: null, problem: "Orgo returned an invalid computer identity" };
  } catch (error) {
    return { available: false, identity: null, problem: error instanceof Error ? error.message : "Could not reach Orgo" };
  }
}

export async function findOrgo(cfg: AppConfig, botId: string, assignedComputerId?: string): Promise<OrgoComputer | null> {
  cfg = snapshotConfig(cfg);
  if (!orgoConfigured(cfg)) return null;
  if (assignedComputerId) {
    if (!UUID.test(assignedComputerId)) return null;
    const computer = await getComputer(cfg, assignedComputerId);
    if (computer) {
      computerIdCache.set(botId, computer.id);
    } else {
      computerIdCache.delete(botId);
    }
    // A pinned assignment is fail-closed: never substitute a similarly named
    // machine or create a second billable computer when it disappears.
    return computer;
  }
  const cached = computerIdCache.get(botId);
  if (cached) {
    const result = await orgoJson(cfg, `/computers/${cached}`);
    const computer = result.ok ? asComputer(result.body) : null;
    if (computer && await orgoNameMatchesBot(botId, computer.name)) return computer;
    computerIdCache.delete(botId);
  }
  const name = await orgoNameFor(botId);
  const computer = (await allComputers(cfg)).find((candidate) => candidate.name === name) ?? null;
  if (computer) {
    computerIdCache.set(botId, computer.id);
    adoptResolvedOrgo(botId, computer.id);
  }
  return computer;
}

async function getComputer(cfg: AppConfig, computerId: string): Promise<OrgoComputer | null> {
  const result = await orgoJson(cfg, `/computers/${computerId}`);
  return result.ok ? asComputer(result.body) : null;
}

async function waitRunning(cfg: AppConfig, computerId: string, budgetMs = 90_000): Promise<OrgoComputer | null> {
  const deadline = Date.now() + budgetMs;
  let computer = await getComputer(cfg, computerId);
  if (computer && SLEEPING.has(computer.status)) {
    const started = await orgoJson(cfg, `/computers/${computerId}/start`, { method: "POST", body: "{}" }, false);
    if (!started.ok) throw Object.assign(new Error(orgoErrorMessage(started.status, "computer start", started.body)), { status: started.status });
  }
  while (Date.now() < deadline) {
    computer = await getComputer(cfg, computerId);
    if (computer && READY.has(computer.status)) return computer;
    if (computer && !PENDING.has(computer.status) && !SLEEPING.has(computer.status)) throw new Error(`Orgo computer is ${computer.status}`);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

export async function readyOrgo(cfg: AppConfig, botId: string, budgetMs = 60_000, assignedComputerId?: string): Promise<OrgoComputer | null> {
  cfg = snapshotConfig(cfg);
  const computer = await findOrgo(cfg, botId, assignedComputerId);
  return computer ? waitRunning(cfg, computer.id, budgetMs) : null;
}

async function managedInstance(cfg: AppConfig, owners: ManagedOrgoOwner[], computerId: string): Promise<ManagedOrgoInventoryInstance> {
  const inventory = await listManagedOrgos(cfg, owners);
  if (!inventory.available) throw Object.assign(new Error(inventory.problem ?? "Orgo inventory is unavailable"), { status: 503 });
  const instance = inventory.instances.find((candidate) => candidate.computerId === computerId);
  if (!instance) throw Object.assign(new Error("that managed Orgo computer was not found"), { status: 404 });
  return instance;
}

export async function sleepManagedOrgo(cfg: AppConfig, owners: ManagedOrgoOwner[], computerId: string, claim?: ManagedOrgoMutationClaim) {
  const instance = await managedInstance(cfg, owners, computerId);
  const release = claim?.(instance);
  try {
    const result = await orgoJson(snapshotConfig(cfg), `/computers/${instance.computerId}/stop`, { method: "POST", body: "{}" }, false);
    if (!result.ok) throw Object.assign(new Error(orgoErrorMessage(result.status, "computer stop", result.body)), { status: result.status });
    return { ok: true };
  } finally { release?.(); }
}

export async function deleteManagedOrgo(cfg: AppConfig, owners: ManagedOrgoOwner[], computerId: string, confirmName: string, claim?: ManagedOrgoMutationClaim) {
  const instance = await managedInstance(cfg, owners, computerId);
  if (confirmName !== instance.name) throw Object.assign(new Error("the confirmation name does not match this Orgo computer"), { status: 409 });
  const release = claim?.(instance);
  try {
    const inspected = await inspectOrgoIdentity(cfg, instance.computerId);
    if (!inspected.available) throw Object.assign(new Error(inspected.problem ?? "computer identity could not be verified"), { status: 503 });
    if (!inspected.identity) {
      retireDeletedOrgoCreate(instance.computerId);
      return { ok: true };
    }
    if (inspected.identity.name !== instance.name || !instance.name.startsWith(scopedPrefix())) throw Object.assign(new Error("computer ownership could not be verified"), { status: 409 });
    const result = await orgoJson(snapshotConfig(cfg), `/computers/${instance.computerId}`, { method: "DELETE" }, false);
    if (!result.ok && result.status !== 404 && result.status !== 410) throw Object.assign(new Error(orgoErrorMessage(result.status, "computer deletion", result.body)), { status: result.status });
    for (const delayMs of [0, 250, 750, 1_500]) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const proof = await inspectOrgoIdentity(cfg, instance.computerId);
      if (proof.available && !proof.identity) {
        retireDeletedOrgoCreate(instance.computerId);
        for (const [botId, id] of computerIdCache) if (id === instance.computerId) computerIdCache.delete(botId);
        return { ok: true };
      }
    }
    throw Object.assign(new Error("Orgo accepted deletion, but it is not confirmed yet — retry shortly"), { status: 503 });
  } finally { release?.(); }
}

async function createOrgo(cfg: AppConfig, botId: string, name: string): Promise<{ computer: OrgoComputer; created: boolean; request: OrgoCreateRequest }> {
  const existing = await findOrgo(cfg, botId);
  if (existing) {
    const attempt = beginOrgoCreate(botId, JSON.stringify({ workspace_id: existing.workspace_id ?? "", name }));
    adoptResolvedOrgo(botId, existing.id);
    return { computer: existing, created: false, request: { ...attempt.request, computerId: existing.id, resolved: true } };
  }
  const body = JSON.stringify({ workspace_id: await workspaceId(cfg), name, os: "linux", ram: 4, cpu: 1, disk_size_gb: 8, resolution: "1280x720x24" });
  const attempt = beginOrgoCreate(botId, body);
  if (!attempt.startedNow && !attempt.request.computerId) {
    const reconciled = await findOrgo(cfg, botId);
    if (reconciled) {
      adoptResolvedOrgo(botId, reconciled.id);
      return { computer: reconciled, created: false, request: { ...attempt.request, computerId: reconciled.id, resolved: true } };
    }
    throw Object.assign(new Error("A previous Orgo create response was lost. Creation is paused to avoid a duplicate billable computer; check Orgo and retry after the computer appears."), { status: 503 });
  }
  let result;
  try {
    result = await orgoJson(cfg, "/computers", { method: "POST", body }, false);
  } catch (error) {
    const reconciled = await findOrgo(cfg, botId).catch(() => null);
    if (reconciled) {
      adoptResolvedOrgo(botId, reconciled.id);
      return { computer: reconciled, created: true, request: { ...attempt.request, computerId: reconciled.id, resolved: true } };
    }
    throw error;
  }
  const computer = result.ok ? asComputer(result.body) : null;
  if (!computer) {
    if (result.status < 500 && result.status !== 409) discardOrgoCreate(attempt.request);
    throw Object.assign(new Error(orgoErrorMessage(result.status, "computer creation", result.body)), { status: result.status });
  }
  let request = rememberCreatedOrgo(attempt.request, computer.id);
  request = resolveOrgoCreate(request);
  computerIdCache.set(botId, computer.id);
  return { computer, created: true, request };
}

function desktopUrl(computer: OrgoComputer): string {
  const base = computer.connection_url?.trim();
  const password = computer.vnc_password ?? computer.password;
  if (!base || !base.startsWith("https://") || !password) throw new Error("Orgo did not return usable desktop connection details");
  const port = Number(process.env.OMB_PORT || process.env.OGB_PORT || 8799);
  const url = new URL(`http://127.0.0.1:${Number.isInteger(port) && port > 0 && port < 65_536 ? port : 8799}/orgo-viewer`);
  url.hash = new URLSearchParams({ connectionUrl: base, password }).toString();
  return url.toString();
}

export async function orgoStatus(cfg: AppConfig, botId: string, assignedComputerId?: string) {
  cfg = snapshotConfig(cfg);
  if (!orgoConfigured(cfg)) return { configured: false, computer: null };
  const computer = await findOrgo(cfg, botId, assignedComputerId);
  return { configured: true, computer: computer ? { computerId: computer.id, state: computer.status, desktopAvailable: Boolean(computer.connection_url) } : null };
}

export async function provisionOrgo(cfg: AppConfig, botId: string, _botName: string, assignedComputerId?: string) {
  cfg = snapshotConfig(cfg);
  if (!orgoConfigured(cfg)) throw new Error("Orgo is not connected — add an Orgo API key in App Settings");
  if (assignedComputerId) {
    const assigned = await findOrgo(cfg, botId, assignedComputerId);
    if (!assigned) throw Object.assign(new Error("the assigned Orgo computer is no longer accessible — choose another computer"), { status: 404 });
    const ready = await waitRunning(cfg, assigned.id);
    if (!ready) throw new Error("Orgo computer did not become ready in time");
    return { computerId: ready.id, machineName: ready.name, reused: true, state: ready.status, joinUrl: desktopUrl(ready) };
  }
  const name = await orgoNameFor(botId);
  const created = await createOrgo(cfg, botId, name);
  const ready = await waitRunning(cfg, created.computer.id);
  if (!ready) throw new Error("Orgo computer did not become ready in time");
  return { computerId: ready.id, machineName: name, reused: !created.created, state: ready.status, joinUrl: desktopUrl(ready) };
}

export async function joinOrgo(cfg: AppConfig, botId: string, assignedComputerId?: string) {
  cfg = snapshotConfig(cfg);
  const computer = await findOrgo(cfg, botId, assignedComputerId);
  if (!computer) throw new Error("no computer yet — provision it first");
  const ready = await waitRunning(cfg, computer.id);
  if (!ready) throw new Error("the Orgo computer did not wake in time");
  return { joinUrl: desktopUrl(ready), state: ready.status };
}

export async function joinReadyOrgo(cfg: AppConfig, botId: string, assignedComputerId?: string) {
  cfg = snapshotConfig(cfg);
  const computer = await findOrgo(cfg, botId, assignedComputerId);
  if (!computer) throw Object.assign(new Error("no computer yet — provision it first"), { status: 409 });
  if (!READY.has(computer.status)) throw Object.assign(new Error("the cloud computer is sleeping or starting — interrupt the bot before waking it"), { status: 409 });
  const fresh = await getComputer(cfg, computer.id);
  if (!fresh) throw Object.assign(new Error("the Orgo computer is no longer available"), { status: 404 });
  return { joinUrl: desktopUrl(fresh), state: fresh.status };
}

export async function sleepOrgo(cfg: AppConfig, botId: string, assignedComputerId?: string) {
  const computer = await findOrgo(cfg, botId, assignedComputerId);
  if (!computer) throw new Error("no computer for this bot");
  const result = await orgoJson(snapshotConfig(cfg), `/computers/${computer.id}/stop`, { method: "POST", body: "{}" }, false);
  if (!result.ok) throw Object.assign(new Error(orgoErrorMessage(result.status, "computer stop", result.body)), { status: result.status });
  computerIdCache.delete(botId);
  return { ok: true };
}

export async function execOnOrgo(cfg: AppConfig, botId: string, command: string, assignedComputerId?: string) {
  const computer = await readyOrgo(cfg, botId, 60_000, assignedComputerId);
  if (!computer) throw new Error("no ready Orgo computer for this bot");
  const out = await runCommand(cfg, computer.id, isolatedRemoteCommand(command));
  return { exitCode: out.exitCode, stdout: out.stdout.slice(-4_000), stderr: out.stderr.slice(-2_000) };
}

export async function screenshotOrgo(cfg: AppConfig, botId: string, knownComputerId?: string) {
  cfg = snapshotConfig(cfg);
  const computer = knownComputerId ? await getComputer(cfg, knownComputerId) : await findOrgo(cfg, botId);
  if (!computer) throw new Error("no computer for this bot yet");
  if (!READY.has(computer.status)) throw new Error(`Orgo computer is ${computer.status}`);
  const result = await orgoJson(cfg, `/computers/${computer.id}/screenshot`);
  const image = result.body?.image ?? result.body?.data;
  if (!result.ok || typeof image !== "string" || !image) throw new Error(orgoErrorMessage(result.status, "screenshot", result.body));
  const inline = image.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  let declared = inline?.[1]?.toLowerCase();
  let png = inline?.[2] ?? image;
  if (!inline && (/^\/api\/storage\//i.test(image) || /^https?:\/\//i.test(image))) {
    const api = new URL(ORGO_API);
    const asset = new URL(image, api);
    // Never forward the account bearer to an arbitrary URL supplied by a
    // provider response. Current Orgo screenshot assets live under this
    // same-origin path.
    if (asset.origin !== api.origin || !asset.pathname.startsWith("/api/storage/")) {
      throw new Error("Orgo returned an unsafe screenshot URL");
    }
    const screenshot = await fetch(asset, { headers: headers(cfg), signal: AbortSignal.timeout(30_000) });
    if (!screenshot.ok) throw new Error(orgoErrorMessage(screenshot.status, "screenshot image"));
    const contentType = screenshot.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "image/png" && contentType !== "image/jpeg") {
      throw new Error("Orgo returned an unsupported screenshot image type");
    }
    declared = contentType === "image/png" ? "png" : "jpeg";
    png = Buffer.from(await screenshot.arrayBuffer()).toString("base64");
  }
  const header = Buffer.from(png.slice(0, 32), "base64");
  const detected = header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ? "png"
    : header.length >= 2 && header[0] === 0xff && header[1] === 0xd8
      ? "jpeg"
      : null;
  // Orgo currently returns PNG on some desktops and JPEG on others. Keep the
  // provider's data-URL type so the renderer does not try to decode a valid
  // PNG as image/jpeg. Headerless legacy payloads retain the previous JPEG
  // fallback for compatibility.
  return { png, format: detected ?? (declared === "png" ? "png" : "jpeg") };
}

export function forgetOrgo(botId: string): void {
  computerIdCache.delete(botId);
}
