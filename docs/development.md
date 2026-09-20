# SDK, AI & Deployment

[Back to the README](../README.md) · [中文说明](README.zh.md)

Detailed workflows for controlling matches, developing AI policies, and running a hosted game. Run these commands from the repository root after `npm ci`. Shell examples that set environment variables inline use Bash; PowerShell equivalents are shown in the README.

## Command-Frame Workflow

Sketch RTS uses command frames as the shared workflow for play, AI control, replay, and benchmark probes.

```text
browser input
internal AI
SDK agent
replay frame
benchmark worker
        |
        v
ordinary GameCommand entries
        |
        v
shared command-frame runtime
        |
        v
simulation core
```

AI policy scripts, SDK agents, and benchmark probes all produce ordinary `GameCommand` entries. That makes AI decisions easy to replay, inspect, fast-forward, and compare across benchmark lanes.

## Deployment Modes

### Static Browser

```bash
npm run build:static
```

Static mode is for local browser gameplay without a backend. The browser owns the local room registry, local AI runtime, command-frame adapter, and match lifecycle.

### Hosted Server

```bash
npm run build
NODE_ENV=production HOST=0.0.0.0 PORT=34573 npm run server
```

Hosted mode serves the game and owns the shared room control plane:

- `GET/POST /api/rooms*` for room setup.
- `GET /api/rooms/:roomId/events` for pre-match room lifecycle updates.
- `/ws/rooms/:roomId` for live lockstep command frames.
- Savegame and debug replay endpoints.
- SDK control endpoints.
- Benchmark dashboard storage and API.

The hosted path is the right target for LAN play, public multiplayer, SDK-controlled matches, and benchmark dashboards.

Hosted room pages use hash routing inside the browser, for example:

```text
https://example.com/sketch-rts/#room=room-id
```

That keeps deployment simple under subpaths such as `/sketch-rts/`: the server only needs to serve the app and API under the mounted base path, while the browser keeps enough room identity to refresh or rejoin without a separate route table.

## SDK

The SDK is designed for programs that want to control the RTS as a system rather than click through it as a human. It can create rooms, reset scenarios, inspect snapshots, issue commands, fast-forward ticks, wait for effects, save/replay debug traces, and run probes.

```ts
import { SketchRtsSdk } from "./src/sdk/client";

const sdk = new SketchRtsSdk("http://127.0.0.1:5173");

const room = await sdk.createRoom({
  id: "sdk-demo",
  host: { id: "agent-host", name: "Agent Host" },
  mapId: "bareDuel",
  visibility: "private",
  humanCount: 1,
  aiCount: 1,
});

const { snapshot } = await sdk.resetRoom(room.id, "bareDuel", {
  aiPlayers: ["enemy"],
  races: { player: "grove", enemy: "ember" },
});

const worker = snapshot.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
const mine = snapshot.resources.find((resource) => resource.id === "gold-player-main");
if (!worker || !mine) throw new Error("demo setup missing worker or mine");

await sdk.roomCommand(room.id, "player", {
  type: "mine",
  unitIds: [worker.id],
  resourceId: mine.id,
});

const result = await sdk.tickRoomUntil(room.id, {
  until: (next) => next.players.player.gold > snapshot.players.player.gold,
  maxTicks: 1400,
  chunkTicks: 140,
});

console.log(result.snapshot.players.player.gold);
```

## AI Scripting

AI scripts are reusable policies. They read a snapshot, emit command-frame entries, and can be used by internal computer slots, SDK-controlled human slots, benchmarks, and replay/debug workflows.

```ts
import { planAiCommandFrameFromSnapshot } from "./src/ai/runtime";
import { SketchRtsSdk } from "./src/sdk/client";

const sdk = new SketchRtsSdk("http://127.0.0.1:5173");
const snapshot = await sdk.roomSnapshot("room-id");

const planned = planAiCommandFrameFromSnapshot(
  snapshot,
  [{ playerId: "player", source: "external-agent", version: "v2" }],
  { teams: { player: "north", enemy: "south" } },
);

await sdk.roomCommands(
  "room-id",
  planned.commands.map(({ playerId, command }) => ({ playerId, command })),
);
```

That shape is intentionally plain: AI does not get a privileged mutation channel. It plays the game by issuing commands.

## CLI Workflow

The current CLI surface is exposed as project scripts:

```bash
npm run play:ai -- new --file .playtest/match.json --map bareDuel --you v2 --enemy v1
npm run play:ai -- step-until --file .playtest/match.json --condition tick --tick 1200
npm run play:ai -- plan --file .playtest/match.json --owner v2
npm run play:ai -- commands

npm run benchmark:ai -- --seed version-18 --map-count 18 --dry-run
npm run benchmark:ai -- --seed version-18 --map-count 18 --workers 8
npm run benchmark:ai-gauntlet -- --seed gauntlet-18 --map-count 18 --dry-run
npm run benchmark:ai-control -- --seed control-50 --map-count 50 --dry-run
npm run test:sdk-smoke
npm run test:sdk-agent-player
```

This workflow is useful for exact reproductions: create a save-backed session, print the current snapshot, inspect planner output, step to a tick, and only then change code.

`npm run play:ai -- commands` prints a machine-readable command manifest. The manifest is the same command table used by help text and tactical command parsing, so future tools can discover available actions without scraping help output or duplicating CLI knowledge.

## Benchmark System

The benchmark system is a first-class AI development loop:

- deterministic benchmark manifests;
- serial and parallel runners;
- command stats and policy telemetry;
- rich score, control, probe, and combat lanes;
- dashboard JSON/log storage;
- browser dashboard at `benchmark.html`.

The benchmark path is deliberately close to the real SDK/runtime path. It should measure the AI that actually plays the game, not a private benchmark-only implementation.
