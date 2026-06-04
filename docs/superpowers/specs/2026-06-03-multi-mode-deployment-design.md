# Multi-Mode Deployment Design

## Goal

Sketch RTS must support two first-class deployment modes:

- `server`: a central server owns API, WebSocket rooms, multiplayer coordination, spectators, benchmark dashboard data, and server-authoritative room ticking.
- `static`: the built frontend can be hosted as plain static assets and played solo in a browser with no API server and no WebSocket server.

The modes must be explicit. Static mode must not be a best-effort fallback after server calls fail.

## Current Difference

Server mode currently boots the browser through `/ws/session`, then uses `/api/rooms` and `/ws/rooms/:roomId` for room setup and lockstep matches. The server owns room state, authoritative command frames, AI ticking, save/debug endpoints, and benchmark dashboard storage.

Static mode cannot use any of those network surfaces. The browser must own the local room setup state, create the `Game`, run AI planning, apply command frames, step the simulation, and render snapshots. Static mode keeps the same room browser, create-room, slot setup, and results UI, but the backing room list is local browser state rather than a server-hosted shared lobby.

## Product Shape

The static single-player mode keeps the existing room UI. There should be no intentional visual fork between server room setup and static room setup:

- Home still offers Rooms and Profile.
- The room browser still renders the same room list surface, backed by local in-memory rooms.
- The create-game form still chooses room name, map, human count, AI count, and privacy, but privacy is inert local metadata in static mode.
- Slot setup still supports map choice, AI/open/closed slot editing, and Start Match.
- Live local rooms can still appear through the same browser-entry model, but they are only rooms created in this browser session.
- Start Match creates a local simulation from the room setup and enters gameplay.

The server mode keeps the existing room browser, profile, public/private rooms, spectators, and LAN/server multiplayer behavior.

## Architecture

Introduce a deployment runtime boundary above the existing `GameAdapter`.

```text
main.ts UI/input/rendering
  -> DeploymentRuntime
      -> ServerDeploymentRuntime
          -> HTTP room control plane
          -> WebSocket session/room transports
          -> SessionSocketGameAdapter / LockstepRoomGameAdapter
      -> StaticSoloDeploymentRuntime
          -> in-memory RoomState setup
          -> local Game + AI runtime + command frames
          -> LocalGameAdapter
```

`main.ts` should stop deciding whether a command or menu action is networked. It should ask the active deployment runtime to list rooms, create/update/start the current setup, enter rooms, close rooms, and provide the active `GameAdapter` after a match starts.

The mode is chosen at build/dev time by `VITE_SKETCH_RTS_DEPLOYMENT`:

- `server`: default for `npm run dev`, `npm run server`, and the current production server build.
- `static`: used by `npm run dev:static` and `npm run build:static`.

The parser must fail loudly on unknown values.

## Static Runtime Contract

`StaticSoloDeploymentRuntime` owns:

- a local room registry for the same room browser UI;
- a local `RoomState | undefined`;
- a local `Game | undefined`;
- AI runtime for AI-controlled slots;
- local frame sequence;
- a tick accumulator driven from browser render time or a small runtime timer;
- local match completion, converting the room to an ended room with results.

It reuses shared room helpers where possible:

- `createRoom`
- `resizeRoomSlots`
- `updateRoomMap`
- `updateRoomSlot`
- `canStartRoom`
- `roomToGameSetup`
- `finishRoom`

It uses shared command-frame primitives instead of direct command mutation:

- local player commands become command frames;
- AI planned commands are included in authoritative local frames;
- each local tick applies one frame and steps simulation.

The static runtime must not import server modules or Node-only APIs.

## Server Runtime Contract

`ServerDeploymentRuntime` wraps the current behavior:

- `/ws/session` for global session snapshots where still needed;
- `/api/rooms*` for room CRUD;
- `/ws/rooms/:roomId` for lockstep room gameplay;
- server room browser and spectators remain available.

The server runtime may continue using `SessionSocketGameAdapter` and `LockstepRoomGameAdapter`.

During this work, the lockstep room path must also be checked for AI ticking. A read-only architecture review found that connected lockstep rooms are excluded from ordinary active-room ticking, while `tickRoomFrame` did not visibly run hosted AI before stepping. If this is confirmed in current code, the implementation must fix it as part of preserving server-mode gameplay while adding static mode.

## Build And Entry Points

Add scripts:

- `dev:static`: Vite dev server with `VITE_SKETCH_RTS_DEPLOYMENT=static`;
- `build:static`: static frontend build with `VITE_SKETCH_RTS_DEPLOYMENT=static`;
- `build:server`: explicit alias for the current server-backed frontend build if useful.

The existing `build` can stay as server mode to avoid changing current deployment behavior.

The benchmark dashboard remains server mode only unless a later checkpoint explicitly designs a static dashboard. Static builds should ship only the game entrypoint and not `benchmark.html`.

## Testing

Use TDD for implementation.

Required automated checks:

- mode parser rejects unknown deployment modes;
- static runtime never calls HTTP or WebSocket surfaces;
- static room setup can create/update/start a local match through the same room helpers;
- static local match advances ticks with AI runtime active;
- server runtime preserves current API/WS path expectations;
- existing full suite passes;
- `npm run build` passes;
- `npm run build:static` passes.

Required YATU proof matrix:

- **Static boot without backend:** serve `build:static` output through a static-only file server, open it with Playwright CLI, and prove the app reaches the same home/Rooms/Profile surface without any `/api/*` request or `/ws/*` connection.
- **Static room setup UI parity:** in static mode, use the visible room browser/create-room/slot setup UI to create a room, change map, change slot counts, edit AI/open/closed slots, and return through the same controls expected in server mode.
- **Static local gameplay loop:** start a static room match, issue a visible player command, and prove both the command effect and continuous tick advancement. This proof must show AI runtime activity, not just a player move followed by one local step.
- **Static room lifecycle:** finish or force a local match result through product-visible state and prove the existing results/rematch/home surfaces still work without backend calls.
- **Server multiplayer preservation:** run server mode through Playwright CLI, create/start a room, issue a room command, and prove room gameplay still uses `/ws/rooms/:roomId` frames rather than HTTP command/snapshot polling.
- **Server AI preservation:** in a server-backed room with AI slots, prove an AI-controlled slot emits or applies commands through the authoritative room frame path while connected lockstep clients are present.
- **Mode isolation:** run static and server builds separately and prove their network surfaces do not cross: static emits no API/WS traffic; server mode still opens `/ws/session` or `/ws/rooms/:roomId` where appropriate.
- **Build artifact proof:** open the production static build output, not only Vite dev mode, so the proof matches the deployable artifact.

Each YATU proof must store a short sanitized summary under `~/share/ops` and keep raw browser traces, request dumps, screenshots, and temporary scripts out of the repo.

## Non-Goals

- Static mode does not support multiplayer.
- Static mode does not expose cross-browser public lobby discovery, cross-browser spectators, SDK HTTP control, savegame HTTP endpoints, or benchmark dashboard storage.
- This checkpoint does not add persistence for static saves.
- This checkpoint does not hide or degrade existing server multiplayer capabilities.

## Completion Criteria

The PR is complete only when both modes are independently proven:

- server mode still passes existing unit/integration/build checks and keeps room multiplayer behavior;
- static mode builds and plays without a backend;
- static and server modes each have multiple independent YATU proofs from the matrix above;
- the deployment mode boundary is centralized and not scattered as ad hoc `if static` checks throughout UI event handlers;
- the official checkpoint/spec docs record the mode boundary and evidence.

## Implementation Evidence - 2026-06-03

Sanitized YATU summary: `~/share/ops/sketch-rts-multi-mode-yatu-2026-06-03.md`.

Automated checks run on branch `codex/multi-mode-deployment`:

- `npm test -- --run` (75 files / 556 tests)
- `npm test -- src/client/deployment/server-runtime.test.ts src/client/deployment/runtime.test.ts src/client/deployment/static-runtime.test.ts src/client/net/local-adapter.test.ts --run`
- `npm test -- src/server/room-net.test.ts src/server/room-host.test.ts --run`
- `npm run build`
- `npm run build:static`
- `npm run build:server`

YATU proofs completed:

- Static Playwright CLI boot and room UI proof on `npm run dev:static -- --port 5175`: Rooms/Profile first viewport, room browser, Create Game, Room Setup, slot rows, Start Match, and live tick advancement.
- Static network isolation proof in the same Playwright CLI run: no `/api/*`, `/ws/*`, `ws://*`, or `wss://*` traffic; no request failures.
- Static production visible command proof: on `build:static` preview, the pointer-lock gate released, a real canvas click selected one worker (`x1`), a right-click issued a visible command (`Workers ordered to mine gold.`), ticks advanced, and no backend traffic was emitted.
- Static production AI runtime proof: on `build:static` preview, the visible Rooms -> Create Room -> Room Setup -> Start Match path on `bareDuel` advanced from tick `4` to tick `40` while `window.__sketchRtsView.enemyOrders` reported `{ move: 1, idle: 2 }`; no backend traffic or request failures were emitted.
- Static production lifecycle proof: Start Match -> Concede -> Results -> Rematch -> Room Setup -> Back/Home completed through visible UI with no backend traffic.
- Server Playwright CLI room UI proof on `PORT=5176 npm run dev`: same Rooms -> Create Room -> Room Setup -> Start Match path reached a live room and advanced ticks.
- Server Playwright CLI network proof: room setup used `GET /api/rooms?userId=...`, `POST /api/rooms`, and `POST /api/rooms/:id/start`; no HTTP snapshot or command polling appeared in the network log.
- Server backend/WebSocket YATU: real HTTP create/start plus real `/ws/rooms/:roomId` connection received authoritative room frames containing enemy AI command types `mine` and `train`.
- Production artifact proof: both `build:static` and `build:server` completed.

Notes:

- An initial Combat Arena lifecycle attempt exposed a selectable-map render error, which this branch fixes with a terrain recipe. Combat Arena itself still does not naturally produce a room winner because it has no buildings, so lifecycle closure uses the static Concede product action.
- Two AI perf tests in `src/shared/sim.test.ts` now use the same CPU-time measurement pattern as the rest of that file instead of wall-clock time, so parallel worker scheduling does not masquerade as sim cost.
- The benchmark dashboard store test now uses the same explicit 15s timeout budget as the adjacent real-benchmark store test, avoiding a default 5s timeout on a deliberately heavy integration path.
- Static Vite builds now exclude the server-only benchmark dashboard entrypoint; default/server builds still include it.
