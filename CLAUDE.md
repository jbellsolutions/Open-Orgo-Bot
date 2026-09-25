# Open Orgo Bot — Claude notes

Read [`AGENTS.md`](AGENTS.md) first; it applies to Claude too.

- This is a fork of [`milind-soni/OpenMausBot`](https://github.com/milind-soni/OpenMausBot)
  (remote `upstream`, push disabled). Keep the fork diff thin: the protected
  invariants in [`docs/UPSTREAM_SYNC.md`](docs/UPSTREAM_SYNC.md) win, upstream
  wins everything else. Resolving merges follows
  [`docs/fork-merge-rules.md`](docs/fork-merge-rules.md).
- Paths the fork deletes from upstream are listed in `.fork/deleted-paths.txt`;
  `node scripts/check-fork-invariants.mjs` must pass before any commit to `main`.
- Upstream syncs run from `scripts/maintenance/sync-upstream.sh` (LaunchAgent
  `ai.openorgobot.maintenance`, Mon/Wed/Fri). Do merges in `.ai-worktrees/`,
  never in the main checkout.
- Gates: `pnpm lint && pnpm typecheck && pnpm test`, plus
  `node scripts/generate-locale.mjs --check`.
