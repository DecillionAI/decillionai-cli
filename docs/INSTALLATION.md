# Installation Guide

This project exposes a global CLI executable named `decillion`.

## 1) Quick install scripts

From repo root:

- Linux: `bash scripts/install-linux.sh`
- macOS: `bash scripts/install-macos.sh`
- Windows Bash: `bash scripts/install-windows.sh`

### What each script does

1. Checks if Node.js and npm are already installed.
2. Installs Node.js/npm if missing.
3. Runs `npm install`.
4. Runs `npm run build`.
5. Runs `npm install -g .`.

## 2) Manual install

```bash
npm install
npm run build
npm install -g .
```

Then test:

```bash
decillion help
```

## 3) Package metadata relevant to CLI

- npm package name: `decillion`
- npm `bin` mapping: `decillion -> dist/index.cjs`
- runtime entry shebang is configured for Node.js execution.

## 4) Platform-specific notes

### Linux

The Linux installer supports several package managers (e.g., apt, dnf, yum, pacman, zypper).

### macOS

The macOS installer uses Homebrew. If Homebrew is not present, it installs Homebrew first.

### Windows (Bash environments)

The Windows installer script is intended for Bash-style shells on Windows and tries:

- `winget`
- `choco`
- `scoop`

If Node.js installation finishes but `npm` is still unavailable in the current shell, open a new terminal and rerun.

