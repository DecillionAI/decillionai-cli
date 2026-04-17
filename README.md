# Decillion CLI (`decillion`)

A TypeScript/Node.js CLI for the **current Decillion protocol model**:

- **creatures** (identity/account + signal dispatch)
- **programs** (deployable/runnable logic under creatures)
- **stores/spaces** (collaboration/message surfaces)
- **miniapp-backed domains** (invites, storage, chains, pc)

## Install

### Quick install scripts

```bash
bash scripts/install-linux.sh      # Linux
bash scripts/install-macos.sh      # macOS
bash scripts/install-windows.sh    # Windows (Bash)
```

### Manual install

```bash
npm install
npm run build
npm install -g .
```

Verify:

```bash
decillion help
```

## Run modes

### Interactive

```bash
decillion
```

### Single command

```bash
decillion creatures.me
```

### Batch string

```bash
decillion --batch "creatures.me; stores.list 0 10"
```

### Batch file

```bash
decillion --batch-file ./commands.txt
```

## Authentication and local state

Login opens local callback flow:

```bash
decillion login <username>
```

Credentials are stored in current working directory:

- `auth/userId.txt`
- `auth/privateKey.txt`

Other local folder used by CLI:

- `files/` (download target)

Logout:

```bash
decillion logout
```

## Miniapp routing environment variables

Some command families (stores/invites/storage/chains/pc) are routed through creature signaling.
Set target IDs per domain:

- `DECILLION_<KEY>_CREATURE_ID`
- `DECILLION_<KEY>_PROGRAM_ID`
- `DECILLION_<KEY>_ENTITY` (optional, default: `main`)
- `DECILLION_<KEY>_STORE_ID` (optional)

Where `<KEY>` is one of:

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

## NPM scripts

```bash
npm run dev
npm run build
npm run start
npm test
```

- `build` compiles TS and prepares `dist/index.cjs`.
- `test` is currently a placeholder script in this repo.

## Docs

- Command reference: [`docs/CLI_REFERENCE.md`](docs/CLI_REFERENCE.md)
- Installation details: [`docs/INSTALLATION.md`](docs/INSTALLATION.md)
