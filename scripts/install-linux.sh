#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

install_node_linux() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo "Node.js and npm already installed: $(node -v) / $(npm -v)"
    return
  fi

  echo "Node.js/npm not found. Installing..."

  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y nodejs npm
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm nodejs npm
  elif command -v zypper >/dev/null 2>&1; then
    sudo zypper install -y nodejs20 npm20 || sudo zypper install -y nodejs npm
  else
    echo "Unsupported Linux package manager. Please install Node.js LTS manually: https://nodejs.org/"
    exit 1
  fi
}

install_node_linux

cd "$PROJECT_DIR"
npm install
npm run build
npm install -g .

echo "Done. Run with: decillion"
