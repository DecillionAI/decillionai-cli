# Installation Guide

This package exposes the global executable:

- `decillion`

## 1) Quick install scripts

From repository root:

- Linux: `bash scripts/install-linux.sh`
- macOS: `bash scripts/install-macos.sh`
- Windows Bash: `bash scripts/install-windows.sh`

Each script attempts to:

1. Ensure Node.js + npm exist.
2. Run `npm install`.
3. Run `npm run build`.
4. Run `npm install -g .`.

## 2) Manual install

```bash
npm install
npm run build
npm install -g .
```

Verify:

```bash
decillion help
```

## 3) First-run setup (recommended)

### Login

```bash
decillion login <username>
```

### Configure miniapp routing env vars

Some command families (`stores`, `invites`, `storage`, `chains`, `pc`) are routed through creature signaling.
Define target routing values:

- `DECILLION_<KEY>_CREATURE_ID`
- `DECILLION_<KEY>_PROGRAM_ID`
- optional `DECILLION_<KEY>_ENTITY` (defaults to `main`)
- optional `DECILLION_<KEY>_STORE_ID`

`<KEY>` values:

- `STORES`
- `INVITES`
- `STORAGE`
- `CHAINS`
- `PC`

Example:

```bash
export DECILLION_STORES_CREATURE_ID="..."
export DECILLION_STORES_PROGRAM_ID="..."
export DECILLION_STORES_ENTITY="main"
```

## 4) Package metadata

- npm package: `decillion`
- bin mapping: `decillion -> dist/index.cjs`

## 5) Platform notes

### Linux

Installer supports common managers (apt/dnf/yum/pacman/zypper).

### macOS

Installer uses Homebrew and installs it if needed.

### Windows (Bash shells)

Installer attempts `winget`, `choco`, and `scoop`.
If Node/npm were just installed, open a new terminal and retry.
