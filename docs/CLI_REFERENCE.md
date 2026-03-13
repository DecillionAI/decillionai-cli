# Decillion CLI Reference

Use `decillion help` anytime to print the built-in command reference.

## Global usage

```bash
decillion [command] [args...]
```

Non-interactive helpers:

```bash
decillion --batch "cmd1; cmd2; cmd3"
decillion --batch-file ./commands.txt
```

## Meta commands

- `help` → print full help
- `help <command>` → print command-specific help
- `clear` → clear interactive terminal screen

## Authentication

| Command | Parameters | Description | Example |
|---|---|---|---|
| `login` | `[username]` | Log in account via browser callback flow. | `login alice123` |
| `logout` | none | Log out and remove local auth files. | `logout` |
| `charge` | none | Create payment checkout URL. | `charge` |
| `printPrivateKey` | none | Print account private key body. | `printPrivateKey` |

## Users

| Command | Parameters | Description | Example |
|---|---|---|---|
| `users.me` | none | Get current user profile. | `users.me` |
| `users.get` | `[userId]` | Get specific user profile. | `users.get 123@global` |
| `users.lockToken` | `[amount] [type] [target]` | Lock tokens for payment/execution. | `users.lockToken 100 pay 145@global` |
| `users.consumeLock` | `[lockId] [type] [amount]` | Consume a lock and settle payment. | `users.consumeLock 4f0f02a8d0 pay 100` |
| `users.list` | `[offset] [count]` | List users (paged). | `users.list 0 10` |

## Points

| Command | Parameters | Description | Example |
|---|---|---|---|
| `points.create` | `[isPublic] [hasPersistentHistory] [origin] [title]` | Create a point. | `points.create true true global study-room` |
| `points.update` | `[pointId] [isPublic] [hasPersistentHistory]` | Update point visibility/history flags. | `points.update 345@global false true` |
| `points.get` | `[pointId]` | Get point details. | `points.get 345@global` |
| `points.delete` | `[pointId]` | Delete point. | `points.delete 345@global` |
| `points.join` | `[pointId]` | Join public point. | `points.join 345@global` |
| `points.myPoints` | `[offset] [count] [origin]` | List your points by origin. | `points.myPoints 0 10 global` |
| `points.list` | `[offset] [count]` | List points (paged). | `points.list 0 10` |
| `points.history` | `[pointId]` | Read point history/signals. | `points.history 345@global` |
| `points.signal` | `[pointId] [userId] [transferType] [data]` | Send message/signal. | `points.signal 345@global - broadcast {"text":"hello"}` |
| `points.fileSignal` | `[pointId] [userId] [transferType] [data]` | Send signal containing file/entity metadata. | `points.fileSignal 345@global 123@global single {"fileId":"789@global"}` |
| `points.paidSignal` | `[pointId] [userId] [transferType] [data] [lockId]` | Send paid signal tied to lock id. | `points.paidSignal 345@global 123@global single {"task":"run"} 4f0f02a8d0` |
| `points.addMember` | `[userId] [pointId] [metadata]` | Add point membership. | `points.addMember 123@global 345@global {"role":"teacher"}` |
| `points.updateMember` | `[userId] [pointId] [metadata]` | Update member metadata. | `points.updateMember 123@global 345@global {"role":"moderator"}` |
| `points.removeMember` | `[userId] [pointId]` | Remove point member. | `points.removeMember 123@global 345@global` |
| `points.listMembers` | `[pointId]` | List point members. | `points.listMembers 345@global` |
| `points.addMachine` | `[pointId] [appId] [machineId]` | Attach machine to point. | `points.addMachine 345@global 984@global 876@global` |

## Invites

| Command | Parameters | Description | Example |
|---|---|---|---|
| `invites.create` | `[pointId] [userId]` | Invite user to point. | `invites.create 345@global 123@global` |
| `invites.cancel` | `[pointId] [userId]` | Cancel point invite. | `invites.cancel 345@global 123@global` |
| `invites.accept` | `[pointId]` | Accept invite. | `invites.accept 345@global` |
| `invites.decline` | `[pointId]` | Decline invite. | `invites.decline 345@global` |

## Storage

| Command | Parameters | Description | Example |
|---|---|---|---|
| `storage.upload` | `[pointId] [filePath] [optional fileId]` | Upload file to point. | `storage.upload 345@global ./book.pdf` |
| `storage.uploadUserEntity` | `[entityId] [filePath] [optional machineId]` | Upload user-scoped entity file. | `storage.uploadUserEntity avatar-v1 ./avatar.png` |
| `storage.download` | `[pointId] [fileId]` | Download file from point. | `storage.download 345@global 789@global` |

## Chains

| Command | Parameters | Description | Example |
|---|---|---|---|
| `chains.create` | `[participants stakes json] [isTemporary]` | Create workchain. | `chains.create {"123.124.125.126":1600} false` |
| `chains.submitBaseTrx` | `[chainId] [key] [payload]` | Submit base transaction. | `chains.submitBaseTrx 1 /points/create {"isPublic":true,"persHist":true,"orig":"global"}` |
| `chains.registerNode` | `[origin]` | Register current node. | `chains.registerNode global` |

## Machines / Apps

| Command | Parameters | Description | Example |
|---|---|---|---|
| `machines.createApp` | `[chainId] [username] [title] [desc]` | Create app on chain. | `machines.createApp 1 calcapp Calculator "simple calc app"` |
| `machines.createMachine` | `[username] [appId] [path] [runtime] [comment]` | Create machine under app. | `machines.createMachine calculator 984@global /api/sum wasm "sum machine"` |
| `machines.deleteMachine` | `[machineId]` | Delete machine. | `machines.deleteMachine 876@global` |
| `machines.updateMachine` | `[machineId] [path] [metadataJsonOrFilePath] [optional promptFile]` | Update path/metadata (JSON string or file path). | `machines.updateMachine 876@global /api/sum '{"public":{"profile":{"title":"Calc"}}}'` |
| `machines.deploy` | `[machineId] [machineFolderPath] [runtime] [metadata]` | Deploy machine project code. | `machines.deploy 876@global ./calculator-proj wasm {}` |
| `machines.runMachine` | `[machineId]` | Run deployed machine. | `machines.runMachine 876@global` |
| `machines.listApps` | `[offset] [count]` | List created apps. | `machines.listApps 0 15` |
| `machines.listMachines` | `[offset] [count]` | List created machines. | `machines.listMachines 0 15` |

## PC

| Command | Parameters | Description | Example |
|---|---|---|---|
| `pc.runPc` | none | Create a cloud Linux PC micro-VM. | `pc.runPc` |

After `pc.runPc`, the prompt enters command pass-through mode where your typed input is sent to the remote PC.

Special escape commands while in PC/log streaming mode:

- `pc stop` → exit remote PC command mode
- `docker logs exit` → exit docker build log streaming mode

## Notes on argument parsing and quoting

- The parser supports single-quoted and double-quoted arguments.
- Values with spaces should be wrapped in quotes.
- JSON payloads should generally be wrapped in single quotes to avoid shell escaping issues.

Examples:

```bash
decillion machines.createApp 1 calcapp Calculator "simple calc app"
decillion points.signal 345@global - broadcast '{"text":"hello from cli"}'
```

## Exit behavior

- Command success returns exit code `0`.
- Unknown command and validation errors return non-zero codes.
- Auth-required commands fail with an auth-related error code if not logged in.

