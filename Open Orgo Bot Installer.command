#!/bin/bash

# Double-click teammate installer for macOS. The bundled installer performs
# architecture selection, release download, SHA-256 verification, rollback,
# installation, and launch. This wrapper keeps the Terminal window open when
# macOS starts it from Finder so failures are readable.

set -euo pipefail

installer_dir="$(cd "$(dirname "$0")" && pwd -P)"
installer_path="${installer_dir}/install.sh"

clear
echo "Open Orgo Bot — teammate installer"
echo

if [ ! -f "$installer_path" ]; then
  echo
  echo "install.sh is missing from the installer folder. Nothing was changed."
  read -r -p "Press Return to close… " _
  exit 1
fi

if ! /bin/bash "$installer_path"; then
  echo
  echo "Installation did not finish. Any previous app was preserved or restored."
  read -r -p "Press Return to close… " _
  exit 1
fi

echo
echo "Open Orgo Bot is installed and opening now."
read -r -p "Press Return to close… " _
