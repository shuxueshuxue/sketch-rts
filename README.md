# Sketch RTS

[中文说明](docs/README.zh.md)

Sketch RTS is an RTS game that runs in your browser, with an AI-native SDK, CLI workflow, and composable scripting system.

It is built around one core gameplay path: player input, internal AI, SDK agents, replays, benchmarks, and multiplayer all produce ordinary command frames for the same simulation. The deployment shape can change, but the gameplay core should not fork.

The project is work in progress. The current focus is stable browser play, deterministic command-frame multiplayer, SDK-controlled AI experimentation, and high-throughput benchmarking.

## Highlights

- Browser RTS gameplay with workers, gold, buildings, upgrades, melee/ranged/caster units, items, neutral camps, mercenary camps, rally points, chat, and room setup.
- AI-native scripting: AI logic is composed from policy scripts that emit normal player commands instead of mutating the simulation directly.
- SDK control surface for room creation, scenario reset, command injection, fast-forward, savegames, debug replay, and benchmark-style probes.
- Flexible deployment: a static browser mode for local play and a hosted server mode for rooms, spectators, WebSocket lockstep, saves, SDK control, and the benchmark dashboard.
- Multiplayer built on command frames, not duplicated gameplay implementations.
- High-performance AI benchmark tooling with parallel workers and a browser dashboard.

## Quick Start

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`.

Useful scripts:

```bash
npm run dev:static          # static browser runtime
PORT=34573 npm run server   # hosted server runtime
npm run build               # default/server production build
npm run build:static        # static production build
npm run benchmark:ai        # AI benchmark runner
npm run play:ai             # exact AI playtest CLI
```

For large AI benchmarks, use a remote benchmark host rather than a laptop. Benchmark runs can be published to the dashboard store consumed by `benchmark.html`.

## One Gameplay Core

Sketch RTS treats commands as the center of the architecture.

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
single simulation core
```

Static mode and hosted mode are product/deployment choices, not separate gameplay engines:

- Static mode keeps room setup and gameplay inside the browser, using a local adapter over the same command-frame runtime.
- Hosted mode uses HTTP for room setup and WebSocket room frames for live gameplay.
- SDK and benchmark flows use the same command and simulation primitives, so an AI decision can be replayed, tested, fast-forwarded, or run in a room without being rewritten.

This is the main invariant: multiple product paths are allowed; one core implementation is required.

## Deployment Modes

### Static Browser

```bash
npm run build:static
```

Static mode is for local browser gameplay without a backend. The browser owns the local room registry, local AI runtime, command-frame adapter, and match lifecycle.

### Hosted Server

```bash
npm run build
HOST=0.0.0.0 PORT=34573 npm run server
```

Hosted mode serves the game and owns the shared room control plane:

- `GET/POST /api/rooms*` for room setup.
- `/ws/rooms/:roomId` for live lockstep command frames.
- Savegame and debug replay endpoints.
- SDK control endpoints.
- Benchmark dashboard storage and API.

The hosted path is the right target for LAN play, public multiplayer, SDK-controlled matches, and benchmark dashboards.

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
npm run play:ai -- new --file /tmp/match.json --map bareDuel --you v2 --opponent v1
npm run play:ai -- step-until --file /tmp/match.json --condition tick --tick 1200
npm run play:ai -- plan --file /tmp/match.json --owner v2

npm run benchmark:ai
npm run benchmark:ai-control
npm run test:sdk-smoke
npm run test:sdk-agent-player
```

This workflow is useful for exact reproductions: create a save-backed session, print the current snapshot, inspect planner output, step to a tick, and only then change code.

## Benchmark System

The benchmark system is a first-class AI development loop:

- deterministic benchmark manifests;
- serial and parallel runners;
- command stats and policy telemetry;
- rich score, control, probe, and combat lanes;
- dashboard JSON/log storage;
- browser dashboard at `benchmark.html`.

The benchmark path is deliberately close to the real SDK/runtime path. It should measure the AI that actually plays the game, not a private benchmark-only implementation.

## Roadmap

- More races with distinct tech trees, unit identities, and strategic pressure.
- Stronger and more varied AI, including LLM integrations for taunts, scouting interpretation, strategic adaptation, and opponent-specific planning.
- Better multiplayer performance, reconnection handling, spectator polish, and public-room operations.
- Mod, map, and campaign systems with durable authoring tools.
- More complete SDK/CLI packaging for external agents and experiments.
- Stronger browser UX: controls, hotkeys, onboarding, replays, and accessibility.

## Credits

Sketch RTS is developed and discussed with the community, including promotion and feedback on [linux.do](https://linux.do/).

The game is deeply inspired by Warcraft III. Thank you to War3 for many of the ideas that shaped the feel of workers, bases, creeping, races, heroes-in-spirit unit readability, and RTS pacing.

