#!/bin/bash
# Keep Open Orgo Bot current with the latest stable OpenMausBot release.
# Run by ~/Library/LaunchAgents/ai.openorgobot.maintenance.plist (Mon/Wed/Fri),
# or by hand:  scripts/maintenance/sync-upstream.sh [--dry-run] [--no-install]
#
# The script owns every gate. Claude (headless) is only asked to resolve merge
# conflicts / fix gate failures, and everything it produces is re-verified here.
#   green -> commit merge, bump patch version, push origin/main, close the
#            upstream-watch issues, build the arm64 app, install-app.sh
#   red   -> main and the installed app untouched; worktree kept; issue comment
#            + macOS notification
set -euo pipefail

REPO="${OOB_REPO:-$HOME/REPOS/Open-Orgo-Bot}"
UPSTREAM_SLUG="milind-soni/OpenMausBot"
ORIGIN_SLUG="jbellsolutions/Open-Orgo-Bot"
STATE_DIR="$HOME/Library/Application Support/open-orgo-bot-maintenance"
LOG_DIR="$HOME/Library/Logs/open-orgo-bot/maintenance"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
CLAUDE_BUDGET_USD="${OOB_CLAUDE_BUDGET_USD:-25}"
DRY_RUN=0
INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-install) INSTALL=0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
if [ "${OOB_DRY_RUN:-0}" = 1 ]; then DRY_RUN=1; fi

mkdir -p "$STATE_DIR" "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$LOG_DIR/sync-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1

log() { printf '%s [sync] %s\n' "$(date '+%H:%M:%S')" "$*"; }
notify() { osascript -e "display notification \"$1\" with title \"Open Orgo Bot maintenance\"" >/dev/null 2>&1 || true; }

LOCK="$STATE_DIR/sync.lock"
if ! mkdir "$LOCK" 2>/dev/null; then log "another sync is running ($LOCK)"; exit 0; fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT

log "log: $LOG  dry-run=$DRY_RUN install=$INSTALL"
cd "$REPO"
for bin in git gh pnpm node; do command -v "$bin" >/dev/null || { log "missing $bin on PATH"; exit 1; }; done
gh auth status >/dev/null 2>&1 || { log "gh is not authenticated"; notify "gh is not authenticated; sync skipped."; exit 1; }

# ---------------------------------------------------------------- watch-only
# Orgo and Hermes ship no package this repo depends on (server/orgo.ts is a
# hand-written client), so new commits/releases there are reported, not merged.
watch_report() {
  local state="$STATE_DIR/watch.json" report=""
  [ -f "$state" ] || echo '{}' > "$state"
  check() { # key, command printing the current marker
    local key="$1" cur prev
    cur="$(eval "$2" 2>/dev/null | head -1 || true)"
    [ -n "$cur" ] || return 0
    prev="$(node -e 'const s=require(process.argv[1]);console.log(s[process.argv[2]]||"")' "$state" "$key")"
    if [ "$cur" != "$prev" ]; then
      report+="  - $key: ${prev:-<first check>} -> $cur"$'\n'
      node -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync(process.argv[1]));s[process.argv[2]]=process.argv[3];fs.writeFileSync(process.argv[1],JSON.stringify(s,null,2))' "$state" "$key" "$cur"
    fi
  }
  check "orgo npm sdk" "npm view orgo version"
  check "orgo pypi sdk" "curl -sf https://pypi.org/pypi/orgo/json | node -pe 'JSON.parse(require(\"fs\").readFileSync(0)).info.version'"
  check "nickvasilescu/korgo-bot" "gh api repos/nickvasilescu/korgo-bot/commits --jq '.[0] | .sha[0:8] + \" \" + (.commit.message|split(\"\n\")[0])'"
  check "nickvasilescu/orgo-mcp" "gh api repos/nickvasilescu/orgo-mcp/commits --jq '.[0] | .sha[0:8] + \" \" + (.commit.message|split(\"\n\")[0])'"
  check "hermes-agent release" "gh api repos/NousResearch/hermes-agent/releases/latest --jq .tag_name"
  if [ -n "$report" ]; then
    log "Orgo / Hermes changes since last run (review server/orgo.ts and server/drivers/acp/hermes.ts if relevant):"
    printf '%s' "$report"
    WATCH_REPORT="$report"
  else
    log "no Orgo / Hermes changes since last run"
  fi
}
WATCH_REPORT=""
watch_report || log "watch report failed (non-fatal)"

# ---------------------------------------------------------------- pick target
git fetch --quiet origin
git checkout --quiet main
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  log "main checkout has local changes; refusing to run"; notify "Sync skipped: local changes in $REPO"; exit 1
fi
git merge --ff-only --quiet origin/main

TAG="$(gh api "repos/$UPSTREAM_SLUG/releases/latest" --jq .tag_name)"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { log "latest upstream release '$TAG' is not a stable semver tag"; exit 1; }
UPSTREAM_REF="refs/upstream-tags/$TAG"
git fetch --quiet --no-tags upstream "+refs/tags/$TAG:$UPSTREAM_REF"
BASE_REF="$(cat UPSTREAM_VERSION 2>/dev/null || true)"
[ -n "$BASE_REF" ] && git fetch --quiet --no-tags upstream "+refs/tags/$BASE_REF:refs/upstream-tags/$BASE_REF" || true
BASE_REF="refs/upstream-tags/${BASE_REF:-$TAG}"

if git merge-base --is-ancestor "$UPSTREAM_REF" HEAD; then
  log "already on upstream $TAG; nothing to merge"
  # A build staged earlier (Mac was busy) gets another chance to install.
  if [ "$INSTALL" = 1 ] && [ "$DRY_RUN" = 0 ] && [ -d "$HOME/Applications/Open Orgo Bot Staged/Open Orgo Bot.app" ]; then
    "$REPO/scripts/maintenance/install-app.sh" --staged || true
  fi
  [ -n "$WATCH_REPORT" ] && notify "No new OpenMausBot release. Orgo/Hermes changes noted in the log."
  exit 0
fi
log "upstream $TAG is new (fork is at $(cat UPSTREAM_VERSION))"
if [ "$DRY_RUN" = 1 ]; then
  log "dry run: would merge $TAG; claude=$CLAUDE_BIN"; "$CLAUDE_BIN" --version || true; exit 0
fi

# ---------------------------------------------------------------- merge
WT="$REPO/.ai-worktrees/sync-$TAG"
BRANCH="sync/$TAG"
if [ -d "$WT" ]; then git worktree remove --force "$WT"; fi
git branch -D "$BRANCH" >/dev/null 2>&1 || true
git worktree add --quiet -b "$BRANCH" "$WT" origin/main
cd "$WT"
git config user.name >/dev/null || git config user.name "Open Orgo Bot maintenance"

fork_deleted() { # prints tracked/unmerged paths matching .fork/deleted-paths.txt
  local patterns; patterns="$(grep -v '^[[:space:]]*#' .fork/deleted-paths.txt | sed '/^[[:space:]]*$/d')"
  { git ls-files; git diff --name-only --diff-filter=U; } | sort -u | while IFS= read -r f; do
    while IFS= read -r p; do
      # shellcheck disable=SC2254
      case "$f" in $p) echo "$f"; break ;; esac
    done <<< "$patterns"
  done
}

set +e
git merge --no-ff --no-commit "$UPSTREAM_REF" >/dev/null 2>&1
set -e
# Mechanical resolutions: fork-deleted paths stay deleted; the locale hash
# file is regenerated from the resolved catalogs.
fork_deleted | while IFS= read -r f; do git rm -rqf --ignore-unmatch -- "$f"; done
if git diff --name-only --diff-filter=U | grep -qx 'src/locales/source-hashes.json'; then
  git checkout --theirs -- src/locales/source-hashes.json && git add src/locales/source-hashes.json
fi

run_claude() { # $1 = task description appended to the rules
  [ -x "$CLAUDE_BIN" ] || { log "claude CLI not found"; return 1; }
  local rules prompt
  rules="$(sed -e "s#\\\$UPSTREAM_REF#$UPSTREAM_REF#g" -e "s#\\\$BASE_REF#$BASE_REF#g" docs/fork-merge-rules.md)"
  prompt="$rules

$1"
  log "asking Claude: $(printf '%s' "$1" | head -1)"
  "$CLAUDE_BIN" -p "$prompt" \
    --model opus \
    --permission-mode dontAsk \
    --max-budget-usd "$CLAUDE_BUDGET_USD" \
    --allowedTools "Read" "Edit" "Write" "Grep" "Glob" \
      "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git status:*)" "Bash(git ls-files:*)" \
      "Bash(grep:*)" "Bash(git rm:*)" "Bash(pnpm lint:*)" "Bash(pnpm typecheck:*)" "Bash(pnpm vitest:*)" \
      "Bash(pnpm exec vitest:*)" "Bash(node scripts/check-fork-invariants.mjs)" "Bash(node scripts/generate-locale.mjs --check)" \
    || return 1
}

conflicts="$(git diff --name-only --diff-filter=U)"
if [ -n "$conflicts" ]; then
  log "$(echo "$conflicts" | wc -l | tr -d ' ') conflicted file(s):"; echo "$conflicts" | sed 's/^/  /'
  run_claude "Task: resolve every merge conflict in these files, following the rules above:
$conflicts
Also look for cleanly merged upstream code that now references removed Box or enterprise modules and fix it." || true
fi
if git grep -lI -E '^(<<<<<<<|>>>>>>>) ' -- . >/dev/null 2>&1; then
  git grep -lI -E '^(<<<<<<<|>>>>>>>) ' -- . | sed 's/^/  markers left: /'
  FAIL_REASON="unresolved conflict markers"
else
  git add -A
  FAIL_REASON=""
fi

# ---------------------------------------------------------------- gates
vitest_with_one_retry() {
  # The suite has timing-sensitive e2e files. A file that fails in the full
  # run gets exactly one isolated re-run; it must pass there to count.
  local out="$LOG_DIR/vitest-$STAMP.log" failed
  pnpm exec vitest run > "$out" 2>&1 && return 0
  failed="$(grep -E '^ FAIL  ' "$out" | sed -E 's/^ FAIL  ([^ >]+).*/\1/' | sort -u)"
  [ -n "$failed" ] || { tail -40 "$out"; return 1; }
  echo "re-running once in isolation:"; echo "$failed" | sed 's/^/  /'
  # shellcheck disable=SC2086
  pnpm exec vitest run $failed
}
gates() {
  pnpm install --frozen-lockfile --prefer-offline >/dev/null &&
  node scripts/check-fork-invariants.mjs &&
  node scripts/generate-locale.mjs --check &&
  pnpm lint &&
  pnpm typecheck &&
  vitest_with_one_retry &&
  pnpm broker:test &&
  pnpm test:electron &&
  pnpm test:packaged-server
}
refresh_locale_hashes() {
  node scripts/generate-locale.mjs --check >/dev/null 2>&1 && return 0
  for f in src/locales/*.json; do
    code="$(basename "$f" .json)"
    case "$code" in en|source-hashes) continue ;; esac
    node scripts/generate-locale.mjs "$code" --accept >/dev/null 2>&1 || true
  done
}
if [ -z "$FAIL_REASON" ]; then
  refresh_locale_hashes
  GATE_LOG="$LOG_DIR/gates-$STAMP.log"
  if ! gates > "$GATE_LOG" 2>&1; then
    log "gates failed; asking Claude for one fix pass (tail of $GATE_LOG):"; tail -40 "$GATE_LOG"
    run_claude "Task: the merge is resolved but verification failed. Fix the root cause without weakening tests or the fork invariants. Failure output (tail):
$(tail -150 "$GATE_LOG")" || true
    git add -A
    refresh_locale_hashes
    if ! gates > "$GATE_LOG" 2>&1; then FAIL_REASON="verification failed (see $GATE_LOG)"; tail -60 "$GATE_LOG"; fi
  fi
fi

upstream_issues() { gh issue list -R "$ORIGIN_SLUG" --label upstream-update --state open --json number,title --jq '.[] | "\(.number)\t\(.title)"'; }

if [ -n "$FAIL_REASON" ]; then
  log "RED: $FAIL_REASON. main and the installed app are untouched; worktree kept at $WT"
  issue="$(upstream_issues | awk -F'\t' -v t="$TAG" 'index($2, t) {print $1; exit}')"
  body="Automated sync to upstream \`$TAG\` did not pass: **$FAIL_REASON**. Worktree kept at \`$WT\` on this Mac; log \`$LOG\`. Nothing was pushed or installed."
  if [ -n "$issue" ]; then gh issue comment "$issue" -R "$ORIGIN_SLUG" --body "$body" >/dev/null || true
  else gh issue create -R "$ORIGIN_SLUG" --label upstream-update --title "Review upstream OpenMausBot $TAG" --body "$body" >/dev/null || true; fi
  notify "Upstream $TAG needs review: $FAIL_REASON"
  exit 1
fi

# ---------------------------------------------------------------- commit + push
NEW_VERSION="$(node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("package.json"));const v=p.version.split(".").map(Number);v[2]++;p.version=v.join(".");fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n");console.log(p.version)')"
echo "$TAG" > UPSTREAM_VERSION
git add package.json UPSTREAM_VERSION
git commit --quiet -m "merge: integrate OpenMausBot $TAG (v$NEW_VERSION)

Automated by scripts/maintenance/sync-upstream.sh; all gates passed
(fork invariants, locale check, lint, typecheck, full test suite)."
git update-ref refs/open-orgo-bot/upstream-last-applied "$UPSTREAM_REF"
git update-ref refs/open-orgo-bot/upstream-last-reported "$UPSTREAM_REF"
cd "$REPO"
git merge --ff-only --quiet "$BRANCH"
git push --quiet origin main
log "pushed v$NEW_VERSION ($TAG) to origin/main"
upstream_issues | while IFS=$'\t' read -r num title; do
  gh issue close "$num" -R "$ORIGIN_SLUG" --comment "Integrated in $(git rev-parse --short HEAD) (Open Orgo Bot v$NEW_VERSION, upstream $TAG)." >/dev/null || true
done

# ---------------------------------------------------------------- build + install
if [ "$INSTALL" = 1 ]; then
  cd "$WT"
  BUILD_LOG="$LOG_DIR/build-$STAMP.log"
  log "building arm64 app ($BUILD_LOG)"
  if pnpm package:prepare > "$BUILD_LOG" 2>&1 && pnpm build:speech >> "$BUILD_LOG" 2>&1 && pnpm build:cua >> "$BUILD_LOG" 2>&1 \
     && pnpm exec electron-builder --mac dir --arm64 --publish never >> "$BUILD_LOG" 2>&1; then
    set +e; "$REPO/scripts/maintenance/install-app.sh" "$WT/release/mac-arm64/Open Orgo Bot.app"; rc=$?; set -e
    case "$rc" in 0) log "installed v$NEW_VERSION" ;; 3) log "staged v$NEW_VERSION (Mac busy)" ;; *) log "install failed rc=$rc" ;; esac
    [ "$rc" = 3 ] && cd "$REPO" && exit 0   # keep worktree: staged copy lives outside it anyway
  else
    log "build failed; source is pushed but the app was not replaced"; tail -40 "$BUILD_LOG"; notify "v$NEW_VERSION pushed but the Mac build failed."
    exit 1
  fi
fi
cd "$REPO"
git worktree remove --force "$WT" && git branch -D "$BRANCH" >/dev/null 2>&1 || true
log "done"
