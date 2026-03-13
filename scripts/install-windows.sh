#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

install_node_windows() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo "Node.js and npm already installed: $(node -v) / $(npm -v)"
    return
  fi

  echo "Node.js/npm not found. Trying package managers..."

  if command -v winget.exe >/dev/null 2>&1; then
    winget.exe install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  elif command -v choco.exe >/dev/null 2>&1; then
    choco.exe install -y nodejs-lts
  elif command -v scoop >/dev/null 2>&1; then
    scoop install nodejs-lts
  else
    echo "No supported Windows package manager found (winget/choco/scoop)."
    echo "Install Node.js LTS manually: https://nodejs.org/"
    exit 1
  fi
}

install_node_windows

if ! command -v npm >/dev/null 2>&1; then
  echo "npm still unavailable in this shell. Reopen terminal and rerun script."
  exit 1
fi

cd "$PROJECT_DIR"
npm install
npm run build
npm install -g .

echo "Done. Run with: decillion"
