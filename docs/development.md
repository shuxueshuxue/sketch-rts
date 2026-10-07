# SDK, AI & Deployment

[Back to the README](../README.md) · [中文说明](README.zh.md)

Detailed workflows for controlling matches, developing AI policies, and running a hosted game. Run these commands from the repository root after `npm ci`. Shell examples that set environment variables inline use Bash. In PowerShell, set each variable first with `$env:NAME = 'value'`.

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
npm run build:production
NODE_ENV=production HOST=0.0.0.0 PORT=34573 node dist-server/index.mjs
```

When serving under a subpath, set both `SKETCH_RTS_BASE_PATH` and `VITE_SKETCH_RTS_BASE_PATH` (for example `/sketch-rts/`) for the build and server.

Hosted mode serves the game and owns the shared room control plane:

- `GET/POST /api/rooms*` for room setup.
- `GET /api/rooms/:roomId/events` for pre-match room lifecycle updates.
- `/ws/rooms/:roomId` for live lockstep command frames.
- Savegame and debug replay endpoints.
- SDK control endpoints.
- Benchmark dashboard storage and API.

The hosted path is the right target for LAN play, public multiplayer, SDK-controlled matches, and benchmark dashboards.

Hosted room pages use query parameters in the browser URL, for example:

```text
https://example.com/sketch-rts/?room=room-id
```

The configuration URL also encodes the selected map and seat settings before a room exists. The room URL identifies the created room. Both refresh under the mounted base path; sharing uses the address bar directly.

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

## Available Opponents

Room setup offers V5, V7 and V8, with different production and combat priorities and shared physical naval services. Choose a faction to select an AI version explicitly; a random faction uses a random compatible policy. V9 is an experimental 1v3 benchmark opponent; earlier versions remain available in the benchmark tools. Historical win rates do not describe current balance.

For the V9 gauntlet and native naval self-play:

```bash
npm run benchmark:ai-v9-gauntlet -- --seed v5-hybrid-50-2026-06-12 --map-count 50
SELFPLAY_TICKS=90000 node --import tsx scripts/naval-selfplay.ts /tmp/naval-selfplay.json
```

Current self-play results and limitations are documented in the [skirmish review](reviews/skirmish-naval-repair.zh.md).

## Adding a unit or building

A unit or building lives in two places:

1. **Rules:** a row in `UNIT_RULES` or `BUILDING_RULES` in [`src/shared/catalog.ts`](../src/shared/catalog.ts) — its stats, where it is trained (`trainedAt`), its race, and special rules as data (`armor`, `casterSlayer`, `regenPerSecond`). Kinds, training lists and race rosters are derived from these rows.
2. **Card:** an entry in [`src/client/content/`](../src/client/content/) — the English and Chinese name and description, the command icon and hotkey, and the function that draws it. Labels, tooltips, the command card and the unit sheet read from the cards.

TypeScript reports a missing card, and `src/client/content/cards.test.ts` checks both languages, that each unit is trained at a building its race can build, and that no menu repeats a hotkey.

## Sound packs

The build or hosted manifest can select a default sound pack. Players choose a different pack, volume or silence in **Settings → Sound pack**. A pack is a folder `audio-packs/<id>/` with a `pack.json` and the files it names:

```json
{
  "name": "My pack",
  "sounds": {
    "melee": { "pitch": 0.08, "max": 4, "kinds": { "footman": { "file": "sword.ogg" }, "golem": { "file": "rock.ogg", "volume": 1.2 } } },
    "arrowShot": { "file": "bow.ogg" },
    "click": { "file": "click.ogg" }
  }
}
```

Events and their types are defined in [`src/client/sound.ts`](../src/client/sound.ts). Menu navigation and button clicks are separate events. Combat sounds follow the actual attack presentation: arrows, cannon, mortar, bolts, flame, stone and magic do not share a generic cannon recording. Use one recording per interface operation; selection and order character voices are suppressed.

A pack can provide a single recording or recordings by source unit `kinds`. `volume` scales the recording, `pitch` permits pitch variation, and `max` caps simultaneous playback. Missing events remain silent.

- **Built in:** packs under `audio-packs/` are found when the game is built or served. The repository carries only `audio-packs/cc0`; git ignores every other folder there. `VITE_SOUND_PACK=<id>` picks the pack played until the player chooses one.
- **Served:** the client also reads `audio-packs/served.json` next to the page — `{"packs": ["<id>"], "default": "<id>"}` — and loads the listed packs from the folders beside it. The repository's file lists none; a server puts its own folder at that path to offer packs without a new build, and withdraws one by removing it from the list.

## Recording clips

`npm run record` films a scene in Node, with no browser: it runs the match on the game's command-frame runtime and draws every frame with the Canvas world renderer. It does not capture the WebGL model layer. Capture the browser on a WebGL2-capable device for full in-game 3D footage.

```bash
npm run record -- --list
npm run record -- --scene infantry-clash --seconds 14 --size 1280x720 --out clip.mp4 --out clip.gif --gif-size 640x360
npm run record -- --scene cavalry-flank --follow 'owner=north,kind=raider|knight' --zoom 1.2
```

A scene module exports a `RecordingScene` ([`src/recorder/scene.ts`](../src/recorder/scene.ts)); the built-in scenes in [`src/recorder/scenes/`](../src/recorder/scenes/) are worked examples. `npm run record -- --help` lists every option.

README battle footage can be reproduced with:

```bash
node --import tsx src/recorder/cli.ts --scene infantry-clash --from 3 --seconds 9 --fps 12 --size 960x540 --out clip.mp4 --out clip.gif --gif-size 768x432
```

Gold mines reserve five workstations across the gather-and-return cycle. Rates are defined in `src/shared/mining.ts` in seconds; a depleted mine still delivers its final carried batch. Building clearance and pointer reach use the same resource body radius. Ordinary building foundations require dry ground; shipyards use the separate shoreline rule.
