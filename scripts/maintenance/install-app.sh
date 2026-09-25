#!/bin/bash
# Safely replace /Applications/Open Orgo Bot.app with a freshly built bundle.
#
#   scripts/maintenance/install-app.sh <path/to/Open Orgo Bot.app> [--force-now]
#   scripts/maintenance/install-app.sh --staged        # retry a staged install
#
# - Re-signs with the stable local identity "Open Orgo Bot Local Signing" when it
#   exists, so macOS Screen Recording / Accessibility grants survive rebuilds.
# - Swaps only when the Mac is idle and no bot activity is recent; otherwise
#   stages the bundle and exits 3 (the next run retries).
# - Backs up the current app (keeps the last 3), relaunches, health-checks the
#   local server, and rolls back automatically on failure.
# App data (~/.openorgobot, ~/Library/Application Support/open-orgo-bot) is never touched.
set -euo pipefail

APP_NAME="Open Orgo Bot"
TARGET="/Applications/${APP_NAME}.app"
BACKUPS="$HOME/Applications/${APP_NAME} Backups"
STAGED_DIR="$HOME/Applications/${APP_NAME} Staged"
STAGED="$STAGED_DIR/${APP_NAME}.app"
SIGN_ID="${OOB_SIGN_IDENTITY:-Open Orgo Bot Local Signing}"
IDLE_MIN="${OOB_IDLE_MINUTES:-20}"
ACTIVITY_MIN="${OOB_ACTIVITY_MINUTES:-10}"
DATA_DIR="$HOME/.openorgobot"
KEEP_BACKUPS=3

log() { printf '%s [install-app] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
notify() { osascript -e "display notification \"$1\" with title \"Open Orgo Bot update\"" >/dev/null 2>&1 || true; }
bundle_version() { /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$1/Contents/Info.plist" 2>/dev/null || echo unknown; }

FORCE_NOW=0
SRC=""
for arg in "$@"; do
  case "$arg" in
    --force-now) FORCE_NOW=1 ;;
    --staged) SRC="$STAGED" ;;
    *) SRC="$arg" ;;
  esac
done
[ -n "$SRC" ] || { echo "usage: $0 <app bundle> [--force-now] | --staged" >&2; exit 2; }
[ -d "$SRC/Contents/MacOS" ] || { log "no app bundle at $SRC"; exit 2; }
NEW_VERSION="$(bundle_version "$SRC")"

# 1. Stable signature (only for a bundle not yet signed by us).
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$SIGN_ID\""; then
  if ! codesign -dvv "$SRC" 2>&1 | grep -q "Authority=$SIGN_ID"; then
    log "re-signing with \"$SIGN_ID\""
    codesign --force --deep --options runtime --preserve-metadata=entitlements,flags --sign "$SIGN_ID" "$SRC"
  fi
  codesign --verify --deep --strict "$SRC"
else
  log "WARNING: signing identity \"$SIGN_ID\" not found; bundle stays ad-hoc and macOS may re-prompt for Screen Recording/Accessibility"
fi

# 2. Idle gate.
is_busy() {
  [ "$FORCE_NOW" = 1 ] && return 1
  pgrep -xq "$APP_NAME" || return 1   # not running: safe
  local idle_s
  idle_s=$(( $(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF; exit}') / 1000000000 ))
  if [ "$idle_s" -lt $(( IDLE_MIN * 60 )) ]; then log "user active ${idle_s}s ago"; return 0; fi
  # Bot turns write their event logs, native transcripts and workspaces here.
  if [ -n "$(find "$DATA_DIR/events" "$DATA_DIR/native" "$DATA_DIR/bots" "$DATA_DIR/task-workspaces" "$DATA_DIR"/messages.db* \
        -type f -mmin -"$ACTIVITY_MIN" -print -quit 2>/dev/null)" ]; then
    log "bot activity in the last ${ACTIVITY_MIN} min"; return 0
  fi
  return 1
}
if is_busy; then
  if [ "$SRC" != "$STAGED" ]; then
    mkdir -p "$STAGED_DIR"; rm -rf "$STAGED"; ditto "$SRC" "$STAGED"
  fi
  log "staged $NEW_VERSION at $STAGED; will install when idle"
  notify "Version $NEW_VERSION is ready and will install when the Mac is idle."
  exit 3
fi

# 3. Swap.
OLD_VERSION="$(bundle_version "$TARGET")"
WAS_RUNNING=0
if pgrep -xq "$APP_NAME"; then
  WAS_RUNNING=1
  log "quitting running app"
  osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  for _ in $(seq 1 60); do pgrep -xq "$APP_NAME" || break; sleep 1; done
  if pgrep -xq "$APP_NAME"; then log "app did not quit; aborting swap"; exit 4; fi
fi

mkdir -p "$BACKUPS"
BACKUP="$BACKUPS/auto ${OLD_VERSION} $(date +%Y%m%d-%H%M%S).app"
if [ -d "$TARGET" ]; then log "backing up $OLD_VERSION -> $BACKUP"; mv "$TARGET" "$BACKUP"; fi
ditto "$SRC" "$TARGET"
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true

# 4. Relaunch + health check (server answers {"app":"openmausbot"} on 8799/18799/28799).
healthy() {
  for port in 8799 18799 28799; do
    curl -sf --max-time 3 "http://127.0.0.1:$port/api/health" | grep -q openmausbot && return 0
  done
  return 1
}
open -g -a "$TARGET"
ok=0
for _ in $(seq 1 90); do
  if pgrep -xq "$APP_NAME" && healthy; then ok=1; break; fi
  sleep 2
done
if [ "$ok" = 1 ] && [ "$(bundle_version "$TARGET")" = "$NEW_VERSION" ]; then
  log "installed $NEW_VERSION (was $OLD_VERSION)"
  rm -rf "$STAGED"
  # keep only the newest automatic backups (hand-made backups are left alone)
  ls -1dt "$BACKUPS"/auto\ *.app 2>/dev/null | tail -n +$(( KEEP_BACKUPS + 1 )) | while IFS= read -r old; do rm -rf "$old"; done
  [ "$WAS_RUNNING" = 1 ] || osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
  notify "Updated to $NEW_VERSION."
  exit 0
fi

log "health check failed for $NEW_VERSION; rolling back to $OLD_VERSION"
osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
for _ in $(seq 1 30); do pgrep -xq "$APP_NAME" || break; sleep 1; done
pkill -x "$APP_NAME" 2>/dev/null || true
FAILED="$BACKUPS/${APP_NAME} ${NEW_VERSION} FAILED $(date +%Y%m%d-%H%M%S).app"
mv "$TARGET" "$FAILED"
[ -d "$BACKUP" ] && mv "$BACKUP" "$TARGET"
[ "$WAS_RUNNING" = 1 ] && open -g -a "$TARGET"
notify "Update to $NEW_VERSION failed its health check and was rolled back."
exit 5
