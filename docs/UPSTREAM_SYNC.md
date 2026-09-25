# Upstream maintenance policy

Open Orgo Bot follows stable releases from
[`milind-soni/OpenMausBot`](https://github.com/milind-soni/OpenMausBot) without
blindly merging them.

## Protected invariants

Every integration must preserve:

1. Open Orgo Bot product identity, artwork, bundle ID, URL scheme, storage
   directory, and release channel.
2. Hermes as the default engine while retaining the other supported engines.
3. Orgo as the cloud-computer provider, with no Box runtime adapter or token.
4. Encrypted desktop credential storage and verified Orgo computer UUIDs.
5. Exact-ID, fail-closed team workstations and the one-turn Open Orgo Bot lease.
6. The manifest-verified built-in Super Browser mount and its approval gates.
7. The desktop mutation-header compatibility contract used by installed apps.
8. Apache-2.0 notices and complete exclusion of upstream `enterprise/`.

## Update flow

1. Fetch the stable upstream tag without enabling pushes to upstream.
2. Create a disposable worktree and temporary integration branch.
3. Inspect new scripts, dependencies, workflows, licenses, and provider changes
   before executing them.
4. Merge in the worktree and resolve only changes whose intent is understood.
5. Search for restored Box calls, upstream product identity, enterprise files,
   credential leaks, and changed storage or protocol identifiers.
6. Run type checking, linting, relevant provider tests, the full unit suite,
   Electron tests, packaged-server smoke tests, and macOS packaging checks.
7. Merge the exact tested commit into the product branch, then build release
   artifacts. Never repeat conflict resolution in the primary checkout.

If a protected behavior cannot be proven safe, leave the primary branch and
installed application untouched and open a review issue describing the exact
upstream version, conflicts, failed checks, and affected files.

## Keeping the fork thin

Every line the fork changes in an upstream file is a future merge conflict.
Prefer adding new files over editing upstream ones, keep upstream internal
names (`OPENMAUSBOT_*` env vars, `@openmausbot/*` packages, protocol message
types) untouched, and list whole paths the fork removes in
`.fork/deleted-paths.txt` so modify/delete conflicts resolve mechanically.
`node scripts/check-fork-invariants.mjs` enforces the checkable invariants.

## Automated monitoring and sync

`.github/workflows/upstream-watch.yml` checks daily for a newer stable release
and opens one deduplicated issue. It never merges or executes upstream code.

On the maintainer's Mac, the LaunchAgent `ai.openorgobot.maintenance`
(`scripts/maintenance/ai.openorgobot.maintenance.plist`) runs
`scripts/maintenance/sync-upstream.sh` Monday, Wednesday and Friday. It merges
the latest stable upstream release in a disposable `.ai-worktrees/` worktree,
resolves fork-deleted paths mechanically, asks headless Claude to resolve any
remaining conflicts under [`fork-merge-rules.md`](fork-merge-rules.md), then
re-runs every gate itself (fork invariants, locale check, lint, typecheck, full
test suite). Only a green result is committed, pushed to `main`, and installed
through `scripts/maintenance/install-app.sh` (idle-gated swap, backup, health
check, automatic rollback). A red result leaves `main` and the installed app
untouched and comments on the upstream-watch issue. The same run reports new
Orgo SDK / korgo-bot / orgo-mcp and Hermes releases for manual review.
Logs: `~/Library/Logs/open-orgo-bot/maintenance/`.
