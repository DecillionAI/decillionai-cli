# Decillion AI CLI (`decillion`)

A TypeScript/Node.js command-line client for interacting with Decillion AI APIs, including:

- account/authentication workflows,
- users and token-lock actions,
- points/spaces collaboration actions,
- invitations,
- file/entity storage,
- chain operations,
- machine/app lifecycle,
- and cloud PC provisioning.

The executable command is:

```bash
decillion
```

## Table of contents

- [Requirements](#requirements)
- [Install](#install)
  - [Option A: Use OS install scripts (Linux/macOS/Windows-Bash)](#option-a-use-os-install-scripts-linuxmacoswindows-bash)
  - [Option B: Manual npm install](#option-b-manual-npm-install)
- [Run modes](#run-modes)
- [Authentication and local state](#authentication-and-local-state)
- [NPM scripts](#npm-scripts)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)

---

## Requirements

- Node.js LTS
- npm
- Network access to Decillion endpoints used by the CLI

> The provided install scripts can install Node.js/npm automatically when possible.

## Install

### Option A: Use OS install scripts (Linux/macOS/Windows-Bash)

From repository root:

#### Linux

```bash
bash scripts/install-linux.sh
```

#### macOS

```bash
bash scripts/install-macos.sh
```

#### Windows (Git Bash / MSYS / Cygwin bash shell)

```bash
bash scripts/install-windows.sh
```

Each installer script attempts to:

1. install Node.js + npm if missing,
2. install project dependencies,
3. build the CLI,
4. globally install the package so `decillion` is available in `PATH`.

### Option B: Manual npm install

```bash
npm install
npm run build
npm install -g .
```

Validate installation:

```bash
decillion help
```

## Run modes

### Interactive shell

```bash
decillion
```

Starts the interactive prompt:

- prompt format: `<username>$`
- built-in help command: `help`
- clear terminal command: `clear`

### Non-interactive single command

```bash
decillion users.me
```

### Non-interactive batch string

```bash
decillion --batch "users.me; users.list 0 10"
```

### Non-interactive batch file

```bash
decillion --batch-file ./commands.txt
```

Batch file notes:

- one command per line,
- blank lines are ignored,
- lines beginning with `#` are treated as comments.

## Authentication and local state

### Login

```bash
decillion login <username>
```

Login starts a local callback server and asks you to open:

- `http://localhost:3000/index.html`

### Credential storage

This CLI stores credentials in the working directory:

- `auth/userId.txt`
- `auth/privateKey.txt`

It also creates:

- `files/` (used by file operations)

### Logout

```bash
decillion logout
```

Removes local credential files.

## NPM scripts

```bash
npm run dev
npm run build
npm run start
npm test
```

- `dev`: builds and starts.
- `build`: compiles TypeScript and prepares `dist/index.cjs` for CLI execution.
- `start`: runs built CLI entry.
- `test`: placeholder script (currently exits with error by design).

## Documentation

- Full command reference: [`docs/CLI_REFERENCE.md`](docs/CLI_REFERENCE.md)
- Install details and platform notes: [`docs/INSTALLATION.md`](docs/INSTALLATION.md)

## Troubleshooting

- If `decillion` is not found after installation, ensure global npm bin directory is in your `PATH`.
- If Windows installation used `winget/choco/scoop`, open a new terminal session before retrying.
- If auth fails, run:

  ```bash
  decillion logout
  decillion login <username>
  ```

