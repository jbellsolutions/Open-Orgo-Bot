#!/usr/bin/env node
// Asserts the Open Orgo Bot fork invariants from docs/UPSTREAM_SYNC.md that
// can be checked mechanically. Run after every upstream merge and in CI.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const fail = (msg) => failures.push(msg);
const read = (p) => readFileSync(join(root, p), "utf8");
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);

// Paths the fork removes from upstream must stay gone.
const patterns = read(".fork/deleted-paths.txt")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"));
for (const file of tracked) if (patterns.some((re) => re.test(file))) fail(`fork-deleted path is back: ${file}`);

// No runtime code may import the removed Box / enterprise modules.
const importRe = /from\s+["'](?:\.\.?\/)+(?:box|box-[\w-]+|drivers\/boxagent|drivers\/chat-box-tools|enterprise\/[\w/.-]+)(?:\.[cm]?[jt]s)?["']/;
for (const file of tracked) {
  if (!/\.(?:[cm]?[jt]sx?)$/.test(file) || !/^(server|src|shared|electron)\//.test(file)) continue;
  if (!existsSync(join(root, file))) continue;
  if (importRe.test(read(file))) fail(`imports a removed Box/enterprise module: ${file}`);
}

// Product identity, storage and update channel.
const builder = read("electron-builder.yml");
if (!/^appId: ai\.openorgobot\.app$/m.test(builder)) fail("electron-builder.yml appId is not ai.openorgobot.app");
if (!/^productName: Open Orgo Bot$/m.test(builder)) fail("electron-builder.yml productName is not Open Orgo Bot");
if (!/schemes: \[openorgobot\]/.test(builder)) fail("electron-builder.yml URL scheme is not openorgobot");
if (!/owner: jbellsolutions\s*\n\s*repo: open-orgo-bot/.test(builder)) fail("electron-builder.yml update feed is not jbellsolutions/open-orgo-bot");
if (!/join\(homedir\(\), "\.openorgobot"\)/.test(read("server/config.ts"))) fail("server/config.ts DATA_DIR no longer defaults to ~/.openorgobot");
const pkg = JSON.parse(read("package.json"));
if (pkg.homepage !== "https://github.com/jbellsolutions/open-orgo-bot") fail(`package.json homepage changed: ${pkg.homepage}`);
if (typeof pkg.version !== "string" || !pkg.version.startsWith("1.")) fail(`package.json version looks like an upstream version: ${pkg.version}`);

// Hermes stays the default engine.
if (!/available\.find\(\(instance\) => instance\.driverKind === "hermesAgent"\)/.test(read("server/default-model-selection.ts"))) {
  fail("server/default-model-selection.ts no longer prefers the Hermes engine");
}

// Orgo stays the cloud-computer provider.
for (const f of ["server/orgo.ts", "server/team-computers.ts"]) if (!existsSync(join(root, f))) fail(`missing Orgo provider file: ${f}`);

// Licensing.
for (const f of ["LICENSE", "NOTICE"]) if (!existsSync(join(root, f))) fail(`missing ${f}`);

if (failures.length) {
  console.error(`fork invariants: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("fork invariants: ok");
