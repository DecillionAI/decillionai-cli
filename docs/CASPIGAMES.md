# Operating CaspiGames from the Decillion CLI 🕹️

[CaspiGames](https://github.com/cosmopole-org/CaspiGames) deploys its
platform services as WASM creatures on a Caspar node, using the same
creature/program/signal model this CLI speaks — so `decillion` works as an
operator console for a gaming node with no extra tooling.

All platform actions ride `creatures.signal` with the standard nested
envelope. The CLI already wraps the correlation-id round-trip
(`creatures/signal/result`), so a signal prints the creature's actual JSON
response.

## Discovering the platform

The deploy report (`CaspiGames/deploy/deployment_report.json`) — or the
platform owner — gives you the main entry ids. The `main` creature is
deployed with entity id `main`:

```bash
# the full service registry: {name, creatureId, programId, entityId} per service
decillion creatures.signal <mainCreatureId> <mainProgramId> main \
  '{"action":"discover","payload":{}}'
```

Use the returned ids for the other services below.

## Games registry

```bash
# every published game (manifests incl. play counts)
decillion creatures.signal <gamesCreatureId> <gamesProgramId> games \
  '{"action":"list","payload":{}}'

# one manifest / a source chunk
decillion creatures.signal <gamesCreatureId> <gamesProgramId> games \
  '{"action":"get","payload":{"gameId":"cube-dash"}}'
decillion creatures.signal <gamesCreatureId> <gamesProgramId> games \
  '{"action":"getChunk","payload":{"gameId":"cube-dash","idx":0}}'

# pull a game from the shelf (developer-owned)
decillion creatures.signal <gamesCreatureId> <gamesProgramId> games \
  '{"action":"unpublish","payload":{"gameId":"cube-dash"}}'
```

Publishing a game is `publish` → `putChunk`* → `finalize`; for anything
beyond a trivial source, prefer the platform's
`CaspiGames/deploy/deploy_platform.py`, which chunks the base64 for you.

## Profiles & leaderboards

```bash
# your own profile (created on first touch, keyed by your signed identity)
decillion creatures.signal <profilesCreatureId> <profilesProgramId> profiles \
  '{"action":"me","payload":{}}'
decillion creatures.signal <profilesCreatureId> <profilesProgramId> profiles \
  '{"action":"setName","payload":{"name":"NodeOp"}}'

# a game's top board / your best
decillion creatures.signal <lbCreatureId> <lbProgramId> leaderboard \
  '{"action":"top","payload":{"gameId":"cube-dash","count":10}}'
decillion creatures.signal <lbCreatureId> <lbProgramId> leaderboard \
  '{"action":"myBest","payload":{"gameId":"cube-dash"}}'
```

## Health checks

Every CaspiGames creature answers `{"action":"health","payload":{}}` — handy
in a `--batch-file` sweep after node maintenance:

```text
creatures.signal <mainCreatureId> <mainProgramId> main {"action":"health","payload":{}}
creatures.signal <gamesCreatureId> <gamesProgramId> games {"action":"health","payload":{}}
creatures.signal <profilesCreatureId> <profilesProgramId> profiles {"action":"health","payload":{}}
creatures.signal <lbCreatureId> <lbProgramId> leaderboard {"action":"health","payload":{}}
```
