<div align="center">

<img src="public/app-icon.png" alt="Open Orgo Bot" width="112">

# Open Orgo Bot

### A local-first AI team for your Mac, powered by Hermes and Orgo computers

[![Upstream](https://img.shields.io/badge/upstream-OpenMausBot%20v0.1.82-5f6cff)](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.82)
[![License](https://img.shields.io/badge/license-Apache--2.0-2ea44f)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-Apple%20silicon%20%7C%20Intel-black?logo=apple)](#install-on-macos)
[![Default agent](https://img.shields.io/badge/default%20agent-Hermes-7c3aed)](https://github.com/NousResearch/hermes-agent)
[![Computer](https://img.shields.io/badge/computer-Orgo-0ea5e9)](https://orgo.ai)
[![Browser routing](https://img.shields.io/badge/browser%20routing-Super%20Browser-2563eb)](https://github.com/jbellsolutions/super-browser)

[Download for Apple silicon](https://github.com/jbellsolutions/Open-Orgo-Bot/releases/latest/download/Open-Orgo-Bot.dmg)
·
[Download for Intel](https://github.com/jbellsolutions/Open-Orgo-Bot/releases/latest/download/Open-Orgo-Bot-intel.dmg)
·
[All releases](https://github.com/jbellsolutions/Open-Orgo-Bot/releases)

</div>

Open Orgo Bot keeps the polished Electron desktop experience from OpenMausBot,
uses Hermes as the default agent, and replaces the upstream Box computer
provider with Orgo. A built-in bridge also discovers a locally installed,
manifest-verified Super Browser bundle for advanced browser routing. It is a
focused open-source fork—not a separate rewrite.

Each bot gets its own conversation, model, memory, tools, and connected apps on
the Mac. A bot can have a private Orgo desktop, or every Auto bot in one team
can share a named Orgo workstation sequentially. You can watch the desktop
live, take control, run shell commands, and stop or restart it from the existing
computer panel.

## Install on macOS

### One-command install

Paste this into Terminal:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/jbellsolutions/Open-Orgo-Bot/main/install.sh)"
```

The installer:

- detects Apple silicon or Intel automatically;
- downloads the matching release from GitHub;
- verifies the DMG against the published SHA-256 checksum;
- preserves the existing app if installation fails;
- installs into `/Applications` or your personal Applications folder; and
- launches Open Orgo Bot when finished.

### Easiest teammate install

Download **Open-Orgo-Bot-Installer.zip** from the [latest release](https://github.com/jbellsolutions/Open-Orgo-Bot/releases/latest), unzip both files into the same folder, and double-click **Open Orgo Bot Installer.command**. It runs the bundled verified installer and leaves the previous app in place if anything fails.

### Manual install

1. Download the [Apple-silicon DMG](https://github.com/jbellsolutions/Open-Orgo-Bot/releases/latest/download/Open-Orgo-Bot.dmg)
   or [Intel DMG](https://github.com/jbellsolutions/Open-Orgo-Bot/releases/latest/download/Open-Orgo-Bot-intel.dmg).
2. Open the DMG and drag **Open Orgo Bot** into **Applications**.
3. Launch it from Applications or Spotlight.

Community builds are checksum-verified but may not yet be notarized with an
Apple Developer ID. The one-command installer handles that case only after the
download checksum matches the checksum published with the GitHub release.

## First run

1. Open **Settings → Engines** and confirm Hermes is available. Open Orgo Bot
   uses the existing Hermes login and model configuration on your Mac.
2. Open **Settings → Connections** and add the account-level Orgo API key once
   if you want remote computers. Chat and local tools work without Orgo.
3. In **Settings → Connections → Super Browser — Built-in**, use **Check
   setup**. If local Playwright reports a missing runtime, **Install local
   Chromium** performs one confirmed download and immediately runs the local
   fixture test. No generic Super Browser token is required.
4. Create a bot, choose a model, and send a message.
5. Open the bot's **Computer** panel, select **Cloud → Orgo**, and choose one
   of your existing Orgo computers. A computer already assigned to another
   agent is labeled and cannot be selected.

To give a whole team one workstation, open the **Team map → Computers →
Connect existing Orgo computer**, paste only the computer UUID, verify the real
name/workspace/state, type its exact name, and assign it to the team. Bots set
to **Auto** then receive the same exact UUID one turn at a time. Connecting an
existing computer never calls Orgo's creation endpoint or consumes another
computer slot.

Secrets entered through the desktop app use the existing encrypted credential
store. Each agent saves one verified Orgo computer UUID. Renaming the computer
does not change the assignment, and a missing assignment fails closed rather
than silently moving the agent onto another screen or creating another paid
computer.

## What changed from upstream

| Area | Open Orgo Bot behavior |
|---|---|
| Desktop application | Existing Electron UI, native Mac window, permissions, computer panel, updater architecture, and DMG packaging |
| Default agent | Hermes; the other upstream engines remain available |
| Cloud computer | Orgo replaces Box across discovery, creation, screen capture, live desktop, input, shell, start, stop, restart, and deletion |
| Browser routing | A fixed, verified **Super Browser — Built-in** MCP bridge is mounted automatically; setup, Chromium install, and pinned-route tests live in Connections while the existing Browser tab stays unchanged |
| Identity | Independent name, artwork, bundle ID, URL scheme, storage directory, and release channel |
| Licensing | Apache-2.0 open-source edition only; upstream `enterprise/` is excluded |
| Upstream base | OpenMausBot `main` at `b94f4a618c4565a5d17275cb5d3d5a52a7e009c0` (includes stable `v0.1.82`) |

## Highlights

- **A real desktop app.** No browser wrapper or replacement interface.
- **Hermes by default.** Use open models through your existing Hermes setup.
- **Private or shared Orgo computers.** Bind one exact UUID to a bot, or assign
  one connected workstation to all Auto bots in a team. Existing computers are
  verified across accessible Orgo workspaces without provisioning another VM.
- **Super Browser routing.** Hermes can plan provider-heavy, anti-bot, proxy,
  fleet, and research workflows while ordinary pages stay in the app's fast
  built-in browser.
- **Human approval controls.** Sensitive tool calls stay behind the app's
  existing approval system.
- **Local-first state.** Bots, conversations, and settings live under
  `~/.openorgobot` on the machine running the app.
- **Multiple engines.** Keep Claude, Codex, Pi, Qwen, Grok, and compatible
  upstream drivers alongside Hermes.
- **Connected apps.** Retains the upstream Composio integration and custom MCP
  server support.
- **Reproducible packaging.** Apple-silicon and Intel artifacts are produced
  from the same pinned source revision.

## Hermes + Super Browser + Orgo

The three pieces have distinct jobs:

1. **Hermes is the agent.** It reasons, selects tools, and remains the default
   engine for newly created bots.
2. **The built-in browser is the everyday web surface.** It handles normal
   navigation, forms, extraction, and visible browser sessions.
3. **Super Browser is the routing and verification layer.** It is used for
   nontrivial provider selection, anti-bot or proxy requirements, fleet work,
   and durable run evidence.
4. **Orgo is the full computer.** Desktop apps, Linux files, and shell work go
   to the bot's assigned Orgo machine.

The Open Orgo Bot agents themselves—Chief of Staff, Pickle, Momo, and their
conversations, memory, and Hermes sessions—remain hosted by this Mac app. The
Orgo computer is their remote screen and Linux workstation; a Hermes or Studio
agent separately installed inside that VM is a different agent system. It does
not inherit the Mac app's conversation or lease.

One Orgo computer has one screen. The app's whole-turn **Open Orgo Bot lease**
prevents two Mac-hosted bots from driving the shared team screen at once.
Resident VM agents, SSH sessions, Tailscale users, and other external automation
are outside that lease and may still contend for the screen. Open Orgo Bot shows
this warning for connected workstations and leaves those resident services,
profiles, browser data, and files untouched.

Every turn receives an app-owned MCP computer bridge pinned to the selected
Orgo UUID. The model never gets a free-form computer-id field, so it cannot
switch itself to another agent's machine. Shell commands use Orgo's
authenticated terminal API through that same pinned bridge. Open Orgo Bot does
not invent an SSH hostname from a VNC URL or private address; native SSH can be
added only when Orgo returns a verified endpoint and host key for the exact
selected computer.

Open Orgo Bot searches for Super Browser in the packaged resources, an
explicit `OOB_SUPER_BROWSER_ROOT`, and the standard Codex/agent skill folders.
Before it executes the MCP launcher, it verifies the bundle's manifest-covered
runtime and rejects changed files or symbolic-link redirects. The app never
passes an Orgo key to Super Browser unless the same turn already owns a
verified app-managed Orgo computer UUID. This disables Super Browser's
otherwise useful create-or-discover fallback and prevents an accidental second
billable computer.

The MCP Servers screen and every bot's Access view show a fixed **Super Browser
— Built-in** row. It cannot be shadowed by a custom server. Connections reports
the verified bundle source/version, automatic mount, local Playwright runtime,
optional provider credential names (never values), and the Orgo route supplied
for the assigned turn. The read-only Orgo test is pinned to General's stored
UUID and cannot discover or create a replacement computer.

The public Open Orgo Bot repository contains the bridge, not a copy of the
separately maintained Super Browser source bundle. This avoids silently
republishing a private dependency; a distributable bundle can be added later
once its release licensing and artifact set are finalized.

## Safety boundaries

Open Orgo Bot does not silently trust a clean Git merge. The maintained fork
protects these invariants during every upstream update:

- Orgo remains the only cloud-computer runtime;
- Hermes remains the default agent;
- product identity, storage, protocol, and updater identifiers do not revert;
- credentials never enter command-line arguments or renderer-readable state;
- the non-redistributable upstream enterprise directory stays absent; and
- relevant unit, Electron, server, provider, and package checks must pass.

The repository includes a daily upstream-release watcher. It opens a GitHub
issue when OpenMausBot publishes a newer stable release; it never merges that
release automatically. Integration is first tested in an isolated worktree.
See [the upstream maintenance policy](docs/UPSTREAM_SYNC.md).

## Build from source

Requirements: macOS, Node.js 24+, pnpm, Xcode Command Line Tools, and at least
one supported agent CLI.

```bash
git clone https://github.com/jbellsolutions/Open-Orgo-Bot.git
cd Open-Orgo-Bot
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm package:mac
```

Development mode:

```bash
pnpm dev:server
pnpm dev
pnpm dev:desktop
```

Packaging writes architecture-specific applications and DMGs to `release/`.
The release workflow supports Developer ID signing and Apple notarization when
the repository's signing secrets are configured.

## Verification

Useful checks before a release:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm broker:test
pnpm test:electron
pnpm test:packaged-server
pnpm package:mac
```

An Orgo-connected end-to-end run is available through
`scripts/e2e-server.mjs --with-orgo`; it requires a real Orgo API key and may
create billable cloud resources.

## Project layout

| Path | Purpose |
|---|---|
| `src/` | React desktop interface |
| `electron/` | Native desktop shell, permissions, secure credentials, and packaging integration |
| `server/` | Agent harness, providers, Orgo adapter, computer proxy, approvals, and local API |
| `scripts/` | Build, packaging, smoke-test, and release utilities |
| `docs/` | Architecture, security, operations, and verification notes |
| `.github/workflows/` | Continuous integration, packaging, releases, and upstream monitoring |

## Updating from OpenMausBot

The `upstream` Git remote points to
[`milind-soni/OpenMausBot`](https://github.com/milind-soni/OpenMausBot) and is
configured as fetch-only. Do not merge an upstream release directly into a
working checkout. Follow [docs/UPSTREAM_SYNC.md](docs/UPSTREAM_SYNC.md), which
requires an isolated integration worktree and explicit protected-invariant
checks before the tested result reaches `main`.

## License and attribution

Open Orgo Bot is licensed under [Apache License 2.0](LICENSE). Copyright and
attribution for the upstream project and bundled third-party components are
retained in [NOTICE](NOTICE), [LICENSING.md](LICENSING.md), and
[`third_party/`](third_party/).

The upstream `enterprise/` directory is intentionally excluded because its
separate license does not permit redistribution or white-labeling without an
agreement. Orgo is an external service dependency and does not change this
repository's open-source license.

Open Orgo Bot is an independent community project. It is not affiliated with
or endorsed by OpenMausBot, Orgo, Nous Research, or xAI.
