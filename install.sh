#!/bin/bash

# Open Orgo Bot macOS installer.
# Downloads the release for this Mac, verifies its published SHA-256 digest,
# installs it without disturbing app data, and launches it.

set -euo pipefail

repository="${OPEN_ORGO_BOT_REPO:-jbellsolutions/Open-Orgo-Bot}"
release_root="https://github.com/${repository}/releases/latest/download"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Open Orgo Bot's one-command installer currently supports macOS." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) asset="Open-Orgo-Bot.dmg" ;;
  x86_64) asset="Open-Orgo-Bot-intel.dmg" ;;
  *)
    echo "Unsupported Mac architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/open-orgo-bot-install.XXXXXX")"
mount_dir="${work_dir}/mounted"
dmg_path="${work_dir}/${asset}"
checksum_path="${work_dir}/SHA256SUMS-macos.txt"
mounted=0

cleanup() {
  if [ "$mounted" -eq 1 ]; then
    hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM

echo "Downloading Open Orgo Bot for $(uname -m)…"
curl --fail --location --silent --show-error --retry 3 \
  "${release_root}/${asset}" --output "$dmg_path"
curl --fail --location --silent --show-error --retry 3 \
  "${release_root}/SHA256SUMS-macos.txt" --output "$checksum_path"

expected="$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1; exit }' "$checksum_path")"
actual="$(shasum -a 256 "$dmg_path" | awk '{ print $1 }')"
if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
  echo "Download verification failed; nothing was installed." >&2
  exit 1
fi

mkdir -p "$mount_dir"
hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$mount_dir" -quiet
mounted=1

source_app="${mount_dir}/Open Orgo Bot.app"
if [ ! -d "$source_app" ]; then
  echo "The verified disk image did not contain Open Orgo Bot.app." >&2
  exit 1
fi

install_root="/Applications"
if [ ! -w "$install_root" ]; then
  install_root="${HOME}/Applications"
  mkdir -p "$install_root"
fi
destination="${install_root}/Open Orgo Bot.app"
backup="${work_dir}/Open Orgo Bot.previous.app"

osascript -e 'tell application "Open Orgo Bot" to quit' >/dev/null 2>&1 || true
if [ -d "$destination" ]; then
  mv "$destination" "$backup"
fi

if ! ditto --rsrc --extattr "$source_app" "$destination"; then
  rm -rf "$destination"
  if [ -d "$backup" ]; then mv "$backup" "$destination"; fi
  echo "Installation failed; the previous app was restored." >&2
  exit 1
fi

# Releases without Apple notarization are accepted only after their published
# checksum succeeds above. Signed/notarized releases make this a no-op.
xattr -dr com.apple.quarantine "$destination" >/dev/null 2>&1 || true

hdiutil detach "$mount_dir" -quiet
mounted=0
open "$destination"

echo "Installed Open Orgo Bot at ${destination}"
