# Decillion CLI Reference

Use `decillion help` for built-in command help.

## Protocol model (current)

The CLI is aligned with the current backend model:

- `creatures` for account/identity and direct signaling
- `programs` for program lifecycle actions
- `stores` for space/store collaboration actions
- `invites`, `storage`, `chains`, and `pc` as command families routed via miniapp signaling

---

> Protocol update note: the backend model now centers on **creatures + programs + stores(spaces)**. Legacy command families (`users`, `points`, `apps`, `machines`) are kept in CLI for compatibility and internally routed to the new endpoint layout.

## Global usage

```bash
decillion [command] [args...]
```

Batch helpers:

```bash
decillion --batch "cmd1; cmd2; cmd3"
decillion --batch-file ./commands.txt
```

## Meta commands

- `help`
- `help <command>`
- `clear`

## Auth & account

| Command | Params | Description |
|---|---|---|
| `login` | `[username]` | Login via browser callback flow. |
| `logout` | none | Clear local auth state. |
| `charge` | none | Generate payment checkout URL. |
| `printPrivateKey` | none | Print local private key body. |

## Creatures

| Command | Params | Description |
|---|---|---|
| `creatures.me` | none | Get current creature profile. |
| `creatures.get` | `[creatureId]` | Get creature by id. |
| `creatures.list` | `[offset] [count]` | List creatures. |
| `creatures.lockToken` | `[amount] [type] [target]` | Lock tokens. |
| `creatures.consumeLock` | `[lockId] [type] [amount]` | Consume token lock. |
| `creatures.signal` | `[creatureId] [programId] [entity] [data] [optional storeId]` | Send direct creature signal. |
| `creatures.createMachine` | `[chainId] [username] [title] [desc]` | Create a machine-type creature. |
| `creatures.listMachines` | `[offset] [count]` | List machine creatures. |

## Stores (spaces)

| Command | Params | Description |
|---|---|---|
| `stores.create` | `[isPublic] [hasPersistentHistory] [origin] [title]` | Create store/space. |
| `stores.update` | `[storeId] [isPublic] [hasPersistentHistory]` | Update store visibility/history. |
| `stores.get` | `[storeId]` | Get store details. |
| `stores.delete` | `[storeId]` | Delete store. |
| `stores.join` | `[storeId]` | Join store. |
| `stores.myPoints` | `[offset] [count] [origin]` | List your stores. |
| `stores.list` | `[offset] [count]` | List stores. |
| `stores.history` | `[storeId]` | Read store history. |
| `stores.signal` | `[storeId] [userId] [transferType] [data]` | Send store signal. |
| `stores.fileSignal` | `[storeId] [userId] [transferType] [data]` | Signal with file/entity metadata. |
| `stores.paidSignal` | `[storeId] [userId] [transferType] [data] [lockId]` | Paid signal with lock. |
| `stores.addMember` | `[userId] [storeId] [metadata]` | Add member. |
| `stores.updateMember` | `[userId] [storeId] [metadata]` | Update member metadata. |
| `stores.removeMember` | `[userId] [storeId]` | Remove member. |
| `stores.listMembers` | `[storeId]` | List members. |
| `stores.addMachine` | `[storeId] [creatureId] [programId]` | Attach creature program to store. |

## Invites

| Command | Params | Description |
|---|---|---|
| `invites.create` | `[storeId] [userId]` | Create invite. |
| `invites.cancel` | `[storeId] [userId]` | Cancel invite. |
| `invites.accept` | `[storeId]` | Accept invite. |
| `invites.decline` | `[storeId]` | Decline invite. |

## Storage

| Command | Params | Description |
|---|---|---|
| `storage.upload` | `[storeId] [filePath] [optional fileId]` | Upload file. |
| `storage.uploadUserEntity` | `[entityId] [filePath] [optional programId]` | Upload creature/user entity. |
| `storage.download` | `[storeId] [fileId]` | Download file. |

## Chains

| Command | Params | Description |
|---|---|---|
| `chains.create` | `[participants stakes json] [isTemporary]` | Create chain. |
| `chains.submitBaseTrx` | `[chainId] [key] [payload]` | Submit base transaction. |
| `chains.registerNode` | `[origin]` | Register node. |

## Programs

| Command | Params | Description |
|---|---|---|
| `programs.create` | `[username] [creatureId] [path] [runtime] [comment]` | Create program under creature. |
| `programs.update` | `[programId] [path] [metadataJsonOrFilePath] [optional promptFile]` | Update program. |
| `programs.delete` | `[programId]` | Delete program. |
| `programs.deploy` | `[programId] [programFolderPath] [runtime] [metadata]` | Deploy program artifacts. |
| `programs.run` | `[programId]` | Run program entity (`main`). |
| `programs.list` | `[offset] [count]` | List programs. |

## PC

| Command | Params | Description |
|---|---|---|
| `pc.run` | none | Start cloud PC flow. |

After `pc.run`, prompt enters remote command pass-through mode.

Escape commands while in pass-through/log mode:

- `pc stop`
- `docker logs exit`

## Quoting notes

- Use quotes for values with spaces.
- Prefer single quotes around JSON payloads.

Examples:

```bash
decillion creatures.createMachine 1 calcapp Calculator "simple calc app"
decillion stores.signal 345@global - broadcast '{"text":"hello"}'
```
