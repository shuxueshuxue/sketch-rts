# Multi-Mode Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sketch RTS deployable as either server-backed multiplayer or static frontend-only solo play while preserving the existing room UI.

**Architecture:** Add a client deployment runtime boundary above `GameAdapter`. Server mode wraps the existing HTTP/WebSocket room/session paths. Static mode provides a local room registry, local simulation, AI runtime, and command-frame ticking behind the same UI calls.

**Tech Stack:** TypeScript, Vite env flags, Vitest, Playwright CLI YATU, existing shared sim/room/AI modules.

---

## File Structure

- Create `src/client/deployment/mode.ts`: parse `VITE_SKETCH_RTS_DEPLOYMENT` into `server | static` and fail loudly on invalid values.
- Create `src/client/deployment/runtime.ts`: shared runtime interfaces consumed by `main.ts`.
- Create `src/client/deployment/server-runtime.ts`: current API/WebSocket behavior behind the runtime interface.
- Create `src/client/deployment/static-runtime.ts`: local room registry, local match start, local AI ticking, and local results.
- Create `src/client/deployment/*.test.ts`: mode, server runtime request paths, static room setup, static gameplay tick/AI behavior.
- Modify `src/client/game-adapter.ts` and `src/client/net/local-adapter.ts`: make local adapter capable of render-time ticking and AI-command-frame application.
- Modify `src/client/main.ts`: replace direct API/WebSocket room/session decisions with deployment runtime calls while keeping the same visible UI.
- Modify `src/server/room-host.ts` and tests if connected lockstep rooms are confirmed to skip hosted AI.
- Modify `package.json`: add `dev:static`, `build:server`, and `build:static`.
- Update `docs/superpowers/specs/2026-06-03-multi-mode-deployment-design.md` with final evidence after implementation.

## Task 1: Deployment Mode Parser

**Files:**
- Create: `src/client/deployment/mode.ts`
- Test: `src/client/deployment/mode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseDeploymentMode } from "./mode";

describe("deployment mode", () => {
  it("defaults to server mode when no deployment flag is provided", () => {
    expect(parseDeploymentMode(undefined)).toBe("server");
  });

  it("accepts explicit server and static modes", () => {
    expect(parseDeploymentMode("server")).toBe("server");
    expect(parseDeploymentMode("static")).toBe("static");
  });

  it("fails loudly for unknown modes", () => {
    expect(() => parseDeploymentMode("offline")).toThrow("Unknown deployment mode offline");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/client/deployment/mode.test.ts --run`

Expected: fail because `src/client/deployment/mode.ts` does not exist.

- [ ] **Step 3: Implement minimal parser**

```ts
export type DeploymentMode = "server" | "static";

export function parseDeploymentMode(value: unknown): DeploymentMode {
  if (value === undefined || value === "") return "server";
  if (value === "server" || value === "static") return value;
  throw new Error(`Unknown deployment mode ${String(value)}`);
}

export function deploymentModeFromEnv(env: { VITE_SKETCH_RTS_DEPLOYMENT?: unknown }): DeploymentMode {
  return parseDeploymentMode(env.VITE_SKETCH_RTS_DEPLOYMENT);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/client/deployment/mode.test.ts --run`

Expected: 1 file, 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/client/deployment/mode.ts src/client/deployment/mode.test.ts
git commit -m "Add deployment mode parser"
```

## Task 2: Static Room Registry

**Files:**
- Create: `src/client/deployment/runtime.ts`
- Create: `src/client/deployment/static-runtime.ts`
- Test: `src/client/deployment/static-runtime.test.ts`

- [ ] **Step 1: Write failing room setup tests**

```ts
import { describe, expect, it } from "vitest";
import { StaticSoloDeploymentRuntime } from "./static-runtime";
import type { LocalUserProfile } from "../../shared/types";

const host: LocalUserProfile = { id: "host", name: "Host" };

describe("static solo deployment runtime", () => {
  it("keeps room browser data in a local registry", async () => {
    const runtime = new StaticSoloDeploymentRuntime();

    const created = await runtime.createRoom({ id: "room-1", host, name: "Local Room", mapId: "bareDuel", humanCount: 1, aiCount: 1, visibility: "public" });
    const rooms = await runtime.listRooms(host.id);

    expect(created).toMatchObject({ id: "room-1", name: "Local Room", status: "open" });
    expect(rooms.map((room) => room.id)).toEqual(["room-1"]);
  });

  it("uses shared room helpers for map, slot, and slot-count edits", async () => {
    const runtime = new StaticSoloDeploymentRuntime();
    await runtime.createRoom({ id: "room-setup", host, humanCount: 1, aiCount: 1 });

    await runtime.updateRoomMap("room-setup", "wildMarches");
    await runtime.updateRoomSlotCounts("room-setup", 1, 2);
    const room = await runtime.updateRoomSlot("room-setup", "slot-2", { controller: "ai", team: "south" });

    expect(room.mapId).toBe("wildMarches");
    expect(room.slots).toHaveLength(3);
    expect(room.slots[1]).toMatchObject({ controller: "ai", team: "south", ready: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/client/deployment/static-runtime.test.ts --run`

Expected: fail because runtime files do not exist.

- [ ] **Step 3: Implement runtime interfaces and local room registry**

```ts
// src/client/deployment/runtime.ts
import type { GameAdapter } from "../game-adapter";
import type { CreateRoomInput, SlotPatch } from "../../shared/rooms";
import type { GameSnapshot, LocalUserProfile, MapId, PlayerId, RoomState } from "../../shared/types";

export type StartedMatch = {
  room: RoomState;
  playerId: PlayerId;
  adapter: GameAdapter;
  snapshot: GameSnapshot;
};

export type DeploymentRuntime = {
  readonly kind: "server" | "static";
  initialAdapter(): GameAdapter;
  listRooms(viewerUserId?: string): Promise<RoomState[]>;
  createRoom(input: CreateRoomInput): Promise<RoomState>;
  getRoom(roomId: string): Promise<RoomState>;
  enterRoom(roomId: string, user: LocalUserProfile): Promise<{ room: RoomState; spectating: boolean; playerId: PlayerId }>;
  updateRoomMap(roomId: string, mapId: MapId): Promise<RoomState>;
  updateRoomSlot(roomId: string, slotId: string, patch: SlotPatch): Promise<RoomState>;
  updateRoomSlotCounts(roomId: string, humanCount: number, aiCount: number): Promise<RoomState>;
  closeRoom(roomId: string, userId: string): Promise<RoomState>;
  startRoom(roomId: string, user: LocalUserProfile): Promise<StartedMatch>;
  connectRoom(room: RoomState, playerId: PlayerId, spectating: boolean, onRoom: (room: RoomState) => void): StartedMatch;
  close(): void;
};
```

```ts
// src/client/deployment/static-runtime.ts
import { createRoom, joinFirstOpenSlot, lobbyVisibleRooms, resizeRoomSlots, updateRoomMap, updateRoomSlot, type CreateRoomInput, type SlotPatch } from "../../shared/rooms";
import type { LocalUserProfile, MapId, PlayerId, RoomState } from "../../shared/types";
import { EmptyGameAdapter } from "../game-adapter";
import type { DeploymentRuntime, StartedMatch } from "./runtime";

export class StaticSoloDeploymentRuntime implements DeploymentRuntime {
  readonly kind = "static" as const;
  private readonly rooms = new Map<string, RoomState>();
  private readonly emptyAdapter = new EmptyGameAdapter();

  initialAdapter() {
    return this.emptyAdapter;
  }

  async listRooms(viewerUserId?: string): Promise<RoomState[]> {
    return lobbyVisibleRooms([...this.rooms.values()], viewerUserId);
  }

  async createRoom(input: CreateRoomInput): Promise<RoomState> {
    if (this.rooms.has(input.id)) throw new Error(`Room ${input.id} already exists`);
    const room = createRoom(input);
    this.rooms.set(room.id, room);
    return room;
  }

  async getRoom(roomId: string): Promise<RoomState> {
    return this.requireRoom(roomId);
  }

  async enterRoom(roomId: string, user: LocalUserProfile): Promise<{ room: RoomState; spectating: boolean; playerId: PlayerId }> {
    let room = this.requireRoom(roomId);
    if (room.status === "open") {
      room = joinFirstOpenSlot(room, user);
      this.rooms.set(room.id, room);
    }
    const slot = room.slots.find((candidate) => candidate.userId === user.id);
    return { room, spectating: room.status === "inMatch" && !slot, playerId: slot?.playerId ?? "player" };
  }

  async updateRoomMap(roomId: string, mapId: MapId): Promise<RoomState> {
    return this.replaceRoom(updateRoomMap(this.requireRoom(roomId), mapId));
  }

  async updateRoomSlot(roomId: string, slotId: string, patch: SlotPatch): Promise<RoomState> {
    return this.replaceRoom(updateRoomSlot(this.requireRoom(roomId), slotId, patch));
  }

  async updateRoomSlotCounts(roomId: string, humanCount: number, aiCount: number): Promise<RoomState> {
    return this.replaceRoom(resizeRoomSlots(this.requireRoom(roomId), humanCount, aiCount));
  }

  async closeRoom(roomId: string, userId: string): Promise<RoomState> {
    const room = this.requireRoom(roomId);
    if (room.hostUserId !== userId) throw new Error("Only the room host can close this room");
    this.rooms.delete(roomId);
    return { ...room, status: "closed" };
  }

  async startRoom(_roomId: string, _user: LocalUserProfile): Promise<StartedMatch> {
    throw new Error("No static match has been started.");
  }

  connectRoom(_room: RoomState, _playerId: PlayerId, _spectating: boolean, _onRoom: (room: RoomState) => void): StartedMatch {
    throw new Error("No static match has been started.");
  }

  close(): void {}

  private requireRoom(roomId: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Unknown room ${roomId}`);
    return room;
  }

  private replaceRoom(room: RoomState): RoomState {
    this.rooms.set(room.id, room);
    return room;
  }
}
```

Also add `EmptyGameAdapter` to `src/client/game-adapter.ts`:

```ts
export class EmptyGameAdapter implements GameAdapter {
  sendCommand(): void {
    throw new Error("No active match.");
  }

  currentSnapshot(): undefined {
    return undefined;
  }

  updateToRenderTime(): boolean {
    return false;
  }

  close(): void {}
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/client/deployment/static-runtime.test.ts src/client/game-adapter.test.ts --run`

Expected: static runtime tests pass and existing adapter tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/deployment/runtime.ts src/client/deployment/static-runtime.ts src/client/deployment/static-runtime.test.ts src/client/game-adapter.ts
git commit -m "Add static room deployment runtime"
```

## Task 3: Static Local Match Ticking

**Files:**
- Modify: `src/client/deployment/static-runtime.ts`
- Modify: `src/client/net/local-adapter.ts`
- Test: `src/client/deployment/static-runtime.test.ts`
- Test: `src/client/net/local-adapter.test.ts`

- [ ] **Step 1: Write failing gameplay tests**

Add to `src/client/deployment/static-runtime.test.ts`:

```ts
it("starts a local match and advances AI-driven ticks without backend transport", async () => {
  const runtime = new StaticSoloDeploymentRuntime({ now: () => runtimeNow });
  let runtimeNow = 0;
  await runtime.createRoom({ id: "room-live", host, mapId: "bareDuel", humanCount: 1, aiCount: 1 });

  const started = await runtime.startRoom("room-live", host);
  const beforeTick = started.snapshot.tick;
  runtimeNow += 1000;
  const changed = started.adapter.updateToRenderTime();
  const after = started.adapter.currentSnapshot();

  expect(started.room.status).toBe("inMatch");
  expect(changed).toBe(true);
  expect(after.tick).toBeGreaterThan(beforeTick);
  expect(after.units.some((unit) => unit.owner === "enemy" && unit.order)).toBe(true);
});
```

Add to `src/client/net/local-adapter.test.ts`:

```ts
it("advances render-time ticks even when no player command is sent", () => {
  let now = 0;
  const game = createGame("bareDuel", { aiPlayers: [] });
  const adapter = new LocalGameAdapter(game, "player", { now: () => now, tickMs: 50 });

  now = 160;
  expect(adapter.updateToRenderTime()).toBe(true);
  expect(adapter.currentSnapshot().tick).toBe(3);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/client/deployment/static-runtime.test.ts src/client/net/local-adapter.test.ts --run`

Expected: fail because local adapter does not support render-time ticking and static runtime cannot start matches.

- [ ] **Step 3: Implement local match ticking**

Update `LocalGameAdapter` to accept optional ticking:

```ts
import { planPresetAiRuntimeCommands, type AiRuntimeState } from "../../ai/runtime";
import { finishRoom } from "../../shared/rooms";
import { snapshotGame, stepGame, type Game } from "../../shared/sim";
import { applyCommandFrame } from "../../shared/sim/frame";
import type { CommandEnvelope } from "../../shared/net/types";
import type { GameCommand, GameSnapshot, PlayerId, RoomState } from "../../shared/types";
import type { GameAdapter } from "../game-adapter";

export type LocalGameAdapterOptions = {
  now?: () => number;
  tickMs?: number;
  aiRuntime?: AiRuntimeState;
  room?: RoomState;
  onRoomEnded?: (room: RoomState) => void;
};

export class LocalGameAdapter implements GameAdapter {
  private sequence = 0;
  private lastUpdate: number;
  private room?: RoomState;

  constructor(
    private readonly game: Game,
    private readonly playerId: PlayerId,
    private readonly options: LocalGameAdapterOptions = {},
  ) {
    this.lastUpdate = this.now();
    this.room = options.room;
  }

  sendCommand(command: GameCommand): void {
    this.applyAndStep([{ playerId: this.playerId, command }]);
  }

  currentSnapshot(): GameSnapshot {
    return snapshotGame(this.game);
  }

  updateToRenderTime(): boolean {
    const tickMs = this.options.tickMs ?? 50;
    const current = this.now();
    let changed = false;
    while (current - this.lastUpdate >= tickMs && !this.game.match.winner) {
      this.applyAndStep([]);
      this.lastUpdate += tickMs;
      changed = true;
    }
    return changed;
  }

  close(): void {}

  private applyAndStep(commands: CommandEnvelope[]): void {
    const aiCommands = this.options.aiRuntime ? planPresetAiRuntimeCommands(this.game, this.options.aiRuntime).commands.map((entry) => ({ playerId: entry.playerId, command: entry.command })) : [];
    applyCommandFrame(this.game, {
      roomId: this.room?.id ?? "local",
      tick: this.game.tick,
      sequence: this.sequence,
      commands: [...commands, ...aiCommands],
    });
    this.sequence += 1;
    stepGame(this.game);
    if (this.room && this.game.match.winner) {
      this.room = finishRoom(this.room, snapshotGame(this.game));
      this.options.onRoomEnded?.(this.room);
    }
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }
}
```

Update `StaticSoloDeploymentRuntime.startRoom` to create `Game`, `AiRuntimeState`, and `LocalGameAdapter` from `roomToGameSetup`.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/client/deployment/static-runtime.test.ts src/client/net/local-adapter.test.ts --run`

Expected: local match ticking and AI tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/deployment/static-runtime.ts src/client/deployment/static-runtime.test.ts src/client/net/local-adapter.ts src/client/net/local-adapter.test.ts
git commit -m "Run static matches locally with AI ticking"
```

## Task 4: Server Runtime Wrapper

**Files:**
- Create: `src/client/deployment/server-runtime.ts`
- Test: `src/client/deployment/server-runtime.test.ts`

- [ ] **Step 1: Write failing server runtime tests**

```ts
import { describe, expect, it } from "vitest";
import { ServerDeploymentRuntime } from "./server-runtime";

describe("server deployment runtime", () => {
  it("uses existing room API paths for room setup", async () => {
    const calls: { path: string; body?: unknown }[] = [];
    const runtime = new ServerDeploymentRuntime({
      fetchJson: async (path, body) => {
        calls.push({ path, body });
        return { id: "room-1", slots: [] };
      },
      createSessionSocket: () => new FakeSocket(),
      createRoomTransport: () => new FakeTransport(),
    });

    await runtime.listRooms("user-1");
    await runtime.createRoom({ id: "room-1", host: { id: "user-1", name: "User" } });
    await runtime.updateRoomMap("room-1", "bareDuel");

    expect(calls.map((call) => call.path)).toEqual(["/api/rooms?userId=user-1", "/api/rooms", "/api/rooms/room-1/map"]);
  });
});

class FakeSocket {
  OPEN = 1;
  readyState = 1;
  sent: string[] = [];

  addEventListener(): void {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {}
}

class FakeTransport {
  send(): void {}
  onMessage(): void {}
  onOpen(): void {}
  close(): void {}
}
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/client/deployment/server-runtime.test.ts --run`

Expected: fail because `server-runtime.ts` does not exist.

- [ ] **Step 3: Implement server runtime**

Move current `requestJson`, session socket creation, room HTTP calls, and room WebSocket connection behavior into `ServerDeploymentRuntime`. Inject `fetchJson`, `createSessionSocket`, and `createRoomTransport` for tests.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/client/deployment/server-runtime.test.ts src/client/game-adapter.test.ts --run`

Expected: server runtime tests and adapter tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/deployment/server-runtime.ts src/client/deployment/server-runtime.test.ts
git commit -m "Wrap server deployment runtime"
```

## Task 5: Wire Runtime Into `main.ts`

**Files:**
- Modify: `src/client/main.ts`
- Modify: `src/client/deployment/runtime.ts`
- Test: existing client deployment tests

- [ ] **Step 1: Add failing mode isolation test**

Add a runtime factory test in `src/client/deployment/runtime.test.ts` that constructs static mode without creating a session socket. Use injected factories to count socket creation:

```ts
import { describe, expect, it } from "vitest";
import { createDeploymentRuntime } from "./runtime";

describe("deployment runtime factory", () => {
  it("does not create server sockets in static mode", () => {
    let sessionSockets = 0;
    let roomTransports = 0;

    const runtime = createDeploymentRuntime("static", {
      createSessionSocket() {
        sessionSockets += 1;
        throw new Error("static mode must not create a session socket");
      },
      createRoomTransport() {
        roomTransports += 1;
        throw new Error("static mode must not create a room transport");
      },
    });

    expect(runtime.kind).toBe("static");
    expect(sessionSockets).toBe(0);
    expect(roomTransports).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/client/deployment/runtime.test.ts --run`

Expected: fail because runtime factory is not implemented.

- [ ] **Step 3: Implement runtime factory and update `main.ts`**

Add `createDeploymentRuntime(mode, dependencies)` and replace direct `new WebSocket("/ws/session")`, `requestJson`, and `connectRoomLockstep` calls in `main.ts` with runtime calls.

Keep UI markup and menu flow unchanged.

- [ ] **Step 4: Run targeted tests**

Run: `npm test -- src/client/deployment --run`

Expected: all deployment runtime tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/main.ts src/client/deployment/runtime.ts src/client/deployment/runtime.test.ts
git commit -m "Select deployment runtime at client boot"
```

## Task 6: Preserve Server AI In Lockstep Rooms

**Files:**
- Modify: `src/server/room-host.ts`
- Test: `src/server/room-host.test.ts` or `src/server/room-net.test.ts`

- [ ] **Step 1: Write failing test**

Add a test proving `tickRoomFrame` runs internal AI commands for a connected lockstep room.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/server/room-host.test.ts --run`

Expected: fail if AI commands are currently skipped in `tickRoomFrame`.

- [ ] **Step 3: Implement minimal fix**

Call hosted AI planning during `tickHostedFrame` before applying/stepping the authoritative frame, or merge AI commands into the same authoritative frame if that preserves replay ordering.

- [ ] **Step 4: Run tests**

Run: `npm test -- src/server/room-host.test.ts src/server/room-net.test.ts --run`

Expected: tests pass and replay frame expectations remain true.

- [ ] **Step 5: Commit**

```bash
git add src/server/room-host.ts src/server/room-host.test.ts src/server/room-net.test.ts
git commit -m "Keep hosted AI active in lockstep rooms"
```

## Task 7: Build Scripts And Static Build

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add scripts**

Add:

```json
"dev:static": "VITE_SKETCH_RTS_DEPLOYMENT=static vite --host 127.0.0.1 --port 5175",
"build:server": "tsc --noEmit && VITE_SKETCH_RTS_DEPLOYMENT=server vite build",
"build:static": "tsc --noEmit && VITE_SKETCH_RTS_DEPLOYMENT=static vite build"
```

Keep `build` as current server-compatible build.

- [ ] **Step 2: Run builds**

Run:

```bash
npm run build
npm run build:static
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "Add static deployment build scripts"
```

## Task 8: Full Automated Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-03-multi-mode-deployment-design.md`

- [ ] **Step 1: Run full tests**

Run: `npm test -- --run`

Expected: all tests pass.

- [ ] **Step 2: Run builds**

Run:

```bash
npm run build
npm run build:static
```

Expected: both builds pass.

- [ ] **Step 3: Update spec evidence**

Append final automated verification results and commands to the spec.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-03-multi-mode-deployment-design.md
git commit -m "Record multi-mode deployment verification"
```

## Task 9: YATU Proof Matrix

**Files:**
- Store summaries outside repo under `~/share/ops/sketch-rts-yatu/multi-mode-deployment/`

- [ ] **Step 1: Static boot proof**

Serve `npm run build:static` output with a static-only HTTP server and use Playwright CLI to verify home/Rooms/Profile renders with no `/api/*` or `/ws/*`.

- [ ] **Step 2: Static setup proof**

Use Playwright CLI to create a room, change map, change slot counts, edit AI/open/closed slots, and navigate back through the retained UI.

- [ ] **Step 3: Static gameplay proof**

Use Playwright CLI to start a local match, issue a command, verify command effect, verify continuous ticks, and verify AI activity.

- [ ] **Step 4: Static lifecycle proof**

Use Playwright CLI to start a tiny static match configured to end quickly, then continue until the product-visible results surface appears. If the existing maps cannot end quickly enough, add a test-only static runtime fixture behind a build-time test flag and prove it is absent from ordinary `build:static`.

- [ ] **Step 5: Server multiplayer proof**

Run server mode, create/start a room, issue a command, and verify `/ws/rooms/:roomId` frames with no HTTP command/snapshot polling.

- [ ] **Step 6: Server AI proof**

Run server mode with AI slots and prove AI commands or AI-owned unit orders occur while connected lockstep clients are present.

- [ ] **Step 7: Mode isolation proof**

Summarize network surfaces for static and server proofs and confirm no cross-mode traffic.

- [ ] **Step 8: Commit evidence references only**

Update the spec with sanitized proof summaries and paths. Do not commit raw traces, request dumps, screenshots, or temporary scripts.

## Task 10: PR

**Files:**
- No source changes unless PR body needs doc updates.

- [ ] **Step 1: Final status check**

Run: `git status --short --branch`

Expected: clean.

- [ ] **Step 2: Push**

Run: `git push -u origin codex/multi-mode-deployment`

- [ ] **Step 3: Create PR**

Use `gh pr create --base codex/lockstep-command-frame --head codex/multi-mode-deployment` while PR #7 is the parent branch. If PR #7 has merged by this task, rebase this branch onto latest `origin/main` and create the PR against `main`.

PR body must include summary, automated verification, YATU proof matrix summaries, and the chosen base branch.
