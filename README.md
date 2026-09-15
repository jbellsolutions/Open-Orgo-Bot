<div align="center">

<img src="public/app-icon.png" alt="Open Orgo Bot" width="112">

# Open Orgo Bot

### A local-first AI team for your Mac, powered by Hermes and Orgo computers

[![Upstream](https://img.shields.io/badge/upstream-OpenMausBot%20v0.1.80-5f6cff)](https://github.com/milind-soni/OpenMausBot/releases/tag/v0.1.80)
[![License](https://img.shields.io/badge/license-Apache--2.0-2ea44f)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-Apple%20silicon%20%7C%20Intel-black?logo=apple)](#install-on-macos)
[![Default agent](https://img.shields.io/badge/default%20agent-Hermes-7c3aed)](https://github.com/NousResearch/hermes-agent)
[![Computer](https://img.shields.io/badge/computer-Orgo-0ea5e9)](https://orgo.ai)

[Download for Apple silicon](https://github.com/jbellsolutions/Open-Orgo-Bot/releases/latest/download/Open-Orgo-Bot.dmg)
·
[Download for Intel](https://github.com/jbellsolutions/Open-Orgo-Bot/releases/latest/download/Open-Orgo-Bot-intel.dmg)
·
[All releases](https://github.com/jbellsolutions/Open-Orgo-Bot/releases)

</div>

Open Orgo Bot keeps the polished Electron desktop experience from OpenMausBot,
uses Hermes as the default agent, and replaces the upstream Box computer
provider with Orgo. It is a focused open-source fork—not a separate rewrite.

Each bot gets its own conversation, model, memory, tools, connected apps, and
optional remote Linux desktop. You can watch the desktop live, take control,
run shell commands, and stop or restart the computer from the existing computer
panel.

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
2. Open **Settings → API keys** and add an Orgo API key if you want remote
   computers. Chat and local tools work without an Orgo account.
3. Create a bot, choose a model, and send a message.
4. Select **Computer → Cloud** to create or attach the bot's Orgo computer.

Secrets entered through the desktop app use the existing encrypted credential
store. An Orgo computer is bound to a verified provider UUID before the app
allows lifecycle or control actions.

## What changed from upstream

| Area | Open Orgo Bot behavior |
|---|---|
| Desktop application | Existing Electron UI, native Mac window, permissions, computer panel, updater architecture, and DMG packaging |
| Default agent | Hermes; the other upstream engines remain available |
| Cloud computer | Orgo replaces Box across discovery, creation, screen capture, live desktop, input, shell, start, stop, restart, and deletion |
| Identity | Independent name, artwork, bundle ID, URL scheme, storage directory, and release channel |
| Licensing | Apache-2.0 open-source edition only; upstream `enterprise/` is excluded |
| Upstream base | OpenMausBot `v0.1.80` (`58b138ff329f78d896286983824c912f50b94faf`) |

## Highlights

- **A real desktop app.** No browser wrapper or replacement interface.
- **Hermes by default.** Use open models through your existing Hermes setup.
- **One Orgo computer per bot.** Persistent remote desktops with screenshots,
  interactive viewing, shell access, and lifecycle controls.
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
