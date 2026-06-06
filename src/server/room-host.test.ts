import { describe, expect, it } from "vitest";
import type { AiScript } from "../ai/policy";
import { createRoomHost } from "./room-host";
import type { LocalUserProfile } from "../shared/types";
import { createAiRuntime } from "../ai/runtime";
import { createGame } from "../shared/sim";
import { seconds } from "../shared/time";
import { LocalGameAdapter } from "../client/net/local-adapter";

const hostUser: LocalUserProfile = { id: "user-host", name: "Host" };
const guestUser: LocalUserProfile = { id: "user-guest", name: "Guest" };

function invalidTrainingAiScript(): AiScript {
  return {
    id: "invalid-hosted-ai-command",
    phase: "economy",
    run(snapshot, owner) {
      const townHall = snapshot.buildings.find((building) => building.owner === owner && building.kind === "townHall");
      expect(townHall).toBeDefined();
      return { type: "train", buildingId: townHall!.id, unitKind: "footman" };
    },
  };
}

function movingEnemyScript(): AiScript {
  return {
    id: "moving-enemy-command",
    phase: "tactics",
    run(snapshot, owner) {
      const enemyWorker = snapshot.units.find((unit) => unit.owner === owner && unit.kind === "worker");
      expect(enemyWorker).toBeDefined();
      return { type: "move", unitIds: [enemyWorker!.id], x: enemyWorker!.x - 80, y: enemyWorker!.y };
    },
  };
}

function resetRoomWithPlayerSiege(host: ReturnType<typeof createRoomHost>, roomId: string, options: { aiPlayers?: string[] } = {}) {
  const result = host.resetRoom(roomId, "bareDuel", {
    aiPlayers: options.aiPlayers ?? [],
    scenario: {
      addUnits: Array.from({ length: 18 }, (_, index) => ({
        id: `replay-siege-${index}`,
        owner: "player",
        kind: "golem",
        x: 3020 + index * 4,
        y: 3020 + index * 4,
      })),
    },
  });
  return result;
}

function playerSiegeAttackCommand() {
  return {
    type: "attack" as const,
    unitIds: Array.from({ length: 18 }, (_, index) => `replay-siege-${index}`),
    targetId: "building-enemy-townhall",
  };
}

describe("server room host", () => {
  it("creates joins configures and starts rooms without a solo-only path", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-1", host: hostUser, slotCount: 3 });

    host.updateSlot(room.id, "slot-2", { controller: "open" });
    host.updateSlot(room.id, "slot-3", { controller: "ai", team: "south" });
    host.joinRoom(room.id, guestUser);
    host.updateSlot(room.id, "slot-2", { ready: true, team: "north" });

    const started = host.startRoom(room.id);
    const snapshot = host.snapshot(room.id);

    expect(started.status).toBe("inMatch");
    expect(snapshot.map.id).toBe("verdantCrossroads");
    expect(snapshot.players.player.race).toBe("grove");
    expect(snapshot.players.enemy.race).toBe("ember");
    expect(host.listRooms()[0]?.status).toBe("inMatch");
  });

  it("lists only public lobby rooms unless a viewer owns a private room", () => {
    const host = createRoomHost();
    host.createRoom({ id: "room-private", host: hostUser, visibility: "private" });
    host.createRoom({ id: "room-public", host: guestUser, visibility: "public" });

    expect(host.listRooms().map((room) => room.id)).toEqual(["room-public"]);
    expect(host.listRooms(hostUser.id).map((room) => room.id)).toEqual(["room-private", "room-public"]);
  });

  it("routes commands by explicit player id so SDK agents can play human slots", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-commands", host: hostUser, slotCount: 2 });
    host.startRoom(room.id);

    const before = host.snapshot(room.id);
    const worker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();

    const after = host.commandRoom(room.id, "player", { type: "move", unitIds: [worker!.id], x: worker!.x + 180, y: worker!.y });

    expect(after.tick).toBe(before.tick + 1);
    expect(after.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
  });

  it("batches room commands for many SDK-controlled slots without changing command semantics", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-batch", host: hostUser, slotCount: 2 });
    host.updateSlot(room.id, "slot-2", { controller: "human", userId: guestUser.id, name: guestUser.name, ready: true, team: "south" });
    host.startRoom(room.id);

    const before = host.snapshot(room.id);
    const playerWorker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const enemyWorker = before.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker");
    expect(playerWorker).toBeDefined();
    expect(enemyWorker).toBeDefined();

    const after = host.commandRooms(room.id, [
      { playerId: "player", command: { type: "move", unitIds: [playerWorker!.id], x: playerWorker!.x + 120, y: playerWorker!.y } },
      { playerId: "enemy", command: { type: "move", unitIds: [enemyWorker!.id], x: enemyWorker!.x - 120, y: enemyWorker!.y } },
    ]);

    expect(after.tick).toBe(before.tick + 1);
    expect(after.units.find((unit) => unit.id === playerWorker!.id)?.order).toMatchObject({ type: "move" });
    expect(after.units.find((unit) => unit.id === enemyWorker!.id)?.order).toMatchObject({ type: "move" });
  });

  it("normalizes duplicate room hires before recording the command frame", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-duplicate-hire", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.resetRoom(room.id, "bareDuel", {
      aiPlayers: [],
      scenario: {
        replaceDefaultMercenaryCamps: true,
        addMercenaryCamps: [{ id: "shared-camp", x: 420, y: 300, radius: 54, hireKind: "mercenary", cost: 160, stock: 1, cooldown: seconds(4.5), cooldownRemaining: 0 }],
      },
    });
    host.enableDebugReplay(room.id, { id: "trace-room-duplicate-hire" });

    const after = host.commandRooms(room.id, [
      { playerId: "player", command: { type: "hire", campId: "shared-camp" } },
      { playerId: "player", command: { type: "hire", campId: "shared-camp" } },
    ]);
    const recorded = host.readDebugReplay(room.id);

    expect(after.units.filter((unit) => unit.owner === "player" && unit.kind === "mercenary")).toHaveLength(1);
    expect(recorded.frames[0]?.commands).toEqual([{ playerId: "player", command: { type: "hire", campId: "shared-camp" } }]);
  });

  it("normalizes duplicate room hires before admission rejects a losing command", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-duplicate-hire-admission", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.resetRoom(room.id, "bareDuel", {
      aiPlayers: [],
      scenario: {
        replaceDefaultMercenaryCamps: true,
        addMercenaryCamps: [{ id: "shared-camp", x: 420, y: 300, radius: 54, hireKind: "mercenary", cost: 160, stock: 1, cooldown: seconds(4.5), cooldownRemaining: 0 }],
      },
    });
    host.enableDebugReplay(room.id, { id: "trace-room-duplicate-hire-admission" });

    expect(() =>
      host.commandRooms(room.id, [
        { playerId: "player", command: { type: "hire", campId: "shared-camp" } },
        { playerId: "enemy", command: { type: "hire", campId: "shared-camp" } },
      ]),
    ).not.toThrow();
    expect(host.readDebugReplay(room.id).frames[0]?.commands).toEqual([{ playerId: "player", command: { type: "hire", campId: "shared-camp" } }]);
  });

  it("normalizes duplicate room item pickups before recording the command frame", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-duplicate-pickup", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.resetRoom(room.id, "bareDuel", {
      aiPlayers: [],
      scenario: {
        addUnits: [
          { id: "pickup-first", owner: "player", kind: "footman", x: 900, y: 900 },
          { id: "pickup-second", owner: "player", kind: "footman", x: 905, y: 900 },
        ],
        addItems: [{ id: "shared-scroll", kind: "guardianScroll", x: 900, y: 900, cooldownRemaining: 0 }],
      },
    });
    host.enableDebugReplay(room.id, { id: "trace-room-duplicate-pickup" });

    const after = host.commandRooms(room.id, [
      { playerId: "player", command: { type: "pickupItem", unitId: "pickup-first", itemId: "shared-scroll" } },
      { playerId: "player", command: { type: "pickupItem", unitId: "pickup-second", itemId: "shared-scroll" } },
    ]);
    const recorded = host.readDebugReplay(room.id);

    expect(after.items.find((item) => item.id === "shared-scroll")?.carrierId).toBe("pickup-first");
    expect(recorded.frames[0]?.commands).toEqual([{ playerId: "player", command: { type: "pickupItem", unitId: "pickup-first", itemId: "shared-scroll" } }]);
  });

  it("fast-forwards only live room matches and records results when a match ends", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-tick", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);

    const result = host.tickRoom(room.id, 240);

    expect(result.ticks).toBe(240);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.cpuMs).toBeGreaterThanOrEqual(0);
    expect(result.snapshot.tick).toBe(240);
  });

  it("ticks a live room from an authoritative command frame before stepping simulation", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-frame-tick", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.enableDebugReplay(room.id, { id: "trace-room-frame-tick" });
    const before = host.snapshot(room.id);
    const worker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const frame = {
      roomId: room.id,
      tick: before.tick,
      sequence: 42,
      commands: [{ playerId: "player", command: { type: "move" as const, unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y } }],
    };

    const result = host.tickRoomFrame(room.id, frame, "browser");
    const recorded = host.readDebugReplay(room.id);

    expect(result.ticks).toBe(1);
    expect(result.snapshot.tick).toBe(1);
    expect(result.snapshot.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
    expect(result.frame.commands).toEqual(
      expect.arrayContaining([
        frame.commands[0],
        expect.objectContaining({ playerId: "enemy", command: expect.objectContaining({ type: "mine" }) }),
      ]),
    );
    expect(recorded.frames[0]).toMatchObject({ roomId: frame.roomId, tick: frame.tick, sequence: frame.sequence, source: "browser" });
    expect(recorded.frames[0]?.commands).toEqual(result.frame.commands);
  });

  it("keeps SDK command-tick frames equivalent to the local authoritative frame runtime", () => {
    const aiScripts = [movingEnemyScript()];
    const localGame = createGame("bareDuel", { aiPlayers: ["enemy"] });
    const localWorker = localGame.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(localWorker).toBeDefined();
    const local = new LocalGameAdapter(localGame, "player", { aiRuntime: createAiRuntime(["enemy"], { scripts: aiScripts }) });

    const host = createRoomHost({ autoTick: false, aiScripts });
    const room = host.createRoom({ id: "room-command-tick-equivalence", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.resetRoom(room.id, "bareDuel", { aiPlayers: ["enemy"] });
    host.enableDebugReplay(room.id, { id: "trace-command-tick-equivalence" });
    const hostedBefore = host.snapshot(room.id);
    const hostedWorker = hostedBefore.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(hostedWorker).toBeDefined();

    const playerCommand = { type: "move" as const, unitIds: [hostedWorker!.id], x: hostedWorker!.x + 80, y: hostedWorker!.y };
    local.sendCommand({ ...playerCommand, unitIds: [localWorker!.id] });
    const hosted = host.commandTickRoom(room.id, [{ playerId: "player", command: playerCommand }], 1);
    const localSnapshot = local.currentSnapshot();
    const hostedEnemyWorker = hosted.snapshot.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker");
    const localEnemyWorker = localSnapshot.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker");
    const recorded = host.readDebugReplay(room.id);

    expect(hosted.snapshot.tick).toBe(localSnapshot.tick);
    expect(hosted.snapshot.units).toEqual(localSnapshot.units);
    expect(hostedEnemyWorker?.order).toEqual(localEnemyWorker?.order);
    if (!hostedEnemyWorker || hostedEnemyWorker.order.type !== "move") throw new Error("expected hosted enemy worker to keep its AI move order");
    expect(recorded.frames).toHaveLength(1);
    expect(recorded.frames[0]?.source).toBe("sdk-agent");
    expect(recorded.frames[0]?.commands).toEqual([
      { playerId: "player", command: playerCommand },
      { playerId: "enemy", command: { type: "move", unitIds: [hostedEnemyWorker!.id], x: hostedEnemyWorker!.order.x, y: hostedEnemyWorker!.order.y } },
    ]);
  });

  it("fails loudly instead of dropping direct command-tick batches with no tick budget", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-command-tick-zero", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    const before = host.snapshot(room.id);
    const worker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();

    expect(() => host.commandTickRoom(room.id, [{ playerId: "player", command: { type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y } }], 0)).toThrow(/ticks must be a positive integer/);
    expect(host.snapshot(room.id).units.find((unit) => unit.id === worker!.id)?.order).toEqual({ type: "idle" });
  });

  it("rejects invalid hosted AI commands in connected room frames before recording or mutating player commands", () => {
    const host = createRoomHost({ aiScripts: [invalidTrainingAiScript()] });
    const room = host.createRoom({ id: "room-frame-invalid-ai", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.enableDebugReplay(room.id, { id: "trace-room-frame-invalid-ai" });
    const before = host.snapshot(room.id);
    const worker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const enemyTownHall = before.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall");
    expect(worker).toBeDefined();
    expect(enemyTownHall).toBeDefined();

    expect(() =>
      host.tickRoomFrame(room.id, {
        roomId: room.id,
        tick: before.tick,
        sequence: 7,
        commands: [{ playerId: "player", command: { type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y } }],
      }),
    ).toThrow(/Hosted command rejected: townHall cannot train footman/);

    const after = host.snapshot(room.id);
    const recorded = host.readDebugReplay(room.id);
    expect(after.tick).toBe(0);
    expect(after.units.find((unit) => unit.id === worker!.id)?.order).toEqual({ type: "idle" });
    expect(after.buildings.find((building) => building.id === enemyTownHall!.id)?.queue).toHaveLength(0);
    expect(recorded.frames).toHaveLength(0);
  });

  it("keeps delayed room frames tolerant of commands that become blocked at apply time", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-frame-transient-block", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    const before = host.snapshot(room.id);
    const worker = before.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const townHall = before.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(worker).toBeDefined();
    expect(townHall).toBeDefined();

    expect(() =>
      host.tickRoomFrame(room.id, {
        roomId: room.id,
        tick: before.tick,
        sequence: 99,
        commands: [{ playerId: "player", command: { type: "build", unitId: worker!.id, buildingKind: "farm", x: townHall!.x + 10, y: townHall!.y } }],
      }),
    ).not.toThrow();
    expect(host.snapshot(room.id).tick).toBe(1);
  });

  it("creates checkpoint frames from live room runtime state", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-checkpoint-frame", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.tickRoom(room.id, 3);

    const checkpoint = host.checkpointRoom(room.id);

    expect(checkpoint.roomId).toBe(room.id);
    expect(checkpoint.tick).toBe(3);
    expect(checkpoint.snapshot.tick).toBe(3);
    expect(checkpoint.nextId).toBeGreaterThanOrEqual(1000);
  });

  it("pauses active-room auto ticking while preserving manual SDK ticks", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-pause", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);

    const paused = host.pauseRoom(room.id);
    host.tickActiveRooms(20);
    const afterAutoTick = host.snapshot(room.id);
    const manual = host.tickRoom(room.id, 3);
    const resumed = host.resumeRoom(room.id);
    host.tickActiveRooms(2);

    expect(paused.autoTick).toBe(false);
    expect(afterAutoTick.tick).toBe(0);
    expect(manual.snapshot.tick).toBe(3);
    expect(resumed.autoTick).toBe(true);
    expect(host.snapshot(room.id).tick).toBe(5);
  });

  it("can exclude rooms from ordinary active-room ticking when a lockstep transport owns them", () => {
    const host = createRoomHost();
    const lockstepRoom = host.createRoom({ id: "room-lockstep-owned", host: hostUser, mapId: "bareDuel" });
    const ordinaryRoom = host.createRoom({ id: "room-ordinary-owned", host: hostUser, mapId: "bareDuel" });
    host.startRoom(lockstepRoom.id);
    host.startRoom(ordinaryRoom.id);

    host.tickActiveRooms(3, { excludeRoomIds: new Set([lockstepRoom.id]) });

    expect(host.snapshot(lockstepRoom.id).tick).toBe(0);
    expect(host.snapshot(ordinaryRoom.id).tick).toBe(3);
  });

  it("resets a live room match with scenario seeds without leaving the room runtime", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-reset", host: hostUser });
    host.startRoom(room.id);

    const reset = host.resetRoom(room.id, "bareDuel", {
      aiPlayers: [],
      scenario: {
        addUnits: [{ id: "unit-reset-wildling", owner: "neutral", kind: "wildling", x: 1600, y: 1400 }],
      },
    });

    expect(reset.room.id).toBe(room.id);
    expect(reset.room.status).toBe("inMatch");
    expect(reset.room.mapId).toBe("bareDuel");
    expect(reset.snapshot.map.id).toBe("bareDuel");
    expect(reset.snapshot.units.some((unit) => unit.id === "unit-reset-wildling")).toBe(true);
    expect(host.snapshot(room.id).map.id).toBe("bareDuel");
  });

  it("builds the 30-slot stress room from ordinary room state rather than AI identity tricks", () => {
    const host = createRoomHost();
    const room = host.createGrandThirtyRoom("grand", hostUser);
    const started = host.startRoom(room.id);
    const snapshot = host.snapshot(room.id);

    expect(started.slots.filter((slot) => slot.controller === "human")).toHaveLength(15);
    expect(started.slots.filter((slot) => slot.controller === "ai")).toHaveLength(15);
    expect(snapshot.map.id).toBe("grandThirty");
    expect(Object.keys(snapshot.players).filter((id) => id.startsWith("human-"))).toHaveLength(15);
    expect(Object.keys(snapshot.players).filter((id) => id.startsWith("ai-"))).toHaveLength(15);
  });

  it("lets the host close a room and removes it from the lobby", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-close", host: hostUser });

    const closed = host.closeRoom(room.id, hostUser.id);

    expect(closed.status).toBe("closed");
    expect(host.listRooms(hostUser.id).some((candidate) => candidate.id === room.id)).toBe(false);
    expect(() => host.getRoom(room.id)).toThrow(/Unknown room/);
  });

  it("rejects room close attempts from non-host users", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-close-reject", host: hostUser });

    expect(() => host.closeRoom(room.id, guestUser.id)).toThrow(/Only the room host/);
    expect(host.getRoom(room.id).status).toBe("open");
  });

  it("saves a live opening and resumes it through an ordinary backend room runtime", () => {
    const directHost = createRoomHost();
    const room = directHost.createRoom({ id: "save-source", host: hostUser });
    directHost.updateSlot(room.id, "slot-2", { controller: "human", userId: guestUser.id, name: guestUser.name, ready: true, team: "south" });
    directHost.startRoom(room.id);

    const opening = directHost.snapshot(room.id);
    const worker = opening.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    directHost.commandRoom(room.id, "player", { type: "move", unitIds: [worker!.id], x: worker!.x + 240, y: worker!.y + 40 });
    directHost.tickRoom(room.id, 40);

    const save = directHost.saveRoom(room.id, { id: "save-opening", label: "worker move opening" });
    const directAfter = directHost.tickRoom(room.id, 60).snapshot;

    const resumedHost = createRoomHost();
    const resumedRoom = resumedHost.continueSave(save.id, save, { roomId: "save-resumed" });
    const resumedAfter = resumedHost.tickRoom(resumedRoom.id, 60).snapshot;

    expect(resumedHost.listSaves()[0]?.id).toBe("save-opening");
    expect(save.room.status).toBe("inMatch");
    expect(JSON.stringify(save)).not.toContain("camera");
    expect(JSON.stringify(save)).not.toContain("selectedIds");
    expect(resumedAfter.tick).toBe(directAfter.tick);
    expect(resumedAfter.units).toEqual(directAfter.units);
    expect(resumedAfter.buildings).toEqual(directAfter.buildings);
    expect(resumedAfter.resources).toEqual(directAfter.resources);
    expect(resumedAfter.match).toEqual(directAfter.match);
  });

  it("records debug replay frames from SDK commands and internal AI commands", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-replay", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    const initial = host.snapshot(room.id);
    const worker = initial.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();

    const trace = host.enableDebugReplay(room.id, { id: "trace-room-replay", label: "debug replay" });
    host.commandTickRoom(room.id, [{ playerId: "player", command: { type: "move", unitIds: [worker!.id], x: worker!.x + 160, y: worker!.y } }], 60);

    const recorded = host.readDebugReplay(room.id);
    const replayed = host.replayDebugToTick(room.id, host.snapshot(room.id).tick);

    expect(trace.initialSave.snapshot.tick).toBe(0);
    expect(recorded.frames.some((frame) => frame.source === "sdk-agent")).toBe(true);
    expect(recorded.frames.some((frame) => frame.source === "internal-ai")).toBe(true);
    expect(replayed.units).toEqual(host.snapshot(room.id).units);
    expect(replayed.buildings).toEqual(host.snapshot(room.id).buildings);
  });

  it("records internal AI frames from the normal active-room tick loop", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-replay-autotick", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.enableDebugReplay(room.id, { id: "trace-room-replay-autotick", label: "debug replay autotick" });

    host.tickActiveRooms(60);

    const recorded = host.readDebugReplay(room.id);
    const replayed = host.replayDebugToTick(room.id, host.snapshot(room.id).tick);

    expect(recorded.frames.some((frame) => frame.source === "internal-ai")).toBe(true);
    expect(replayed.units).toEqual(host.snapshot(room.id).units);
    expect(replayed.buildings).toEqual(host.snapshot(room.id).buildings);
  });

  it("rejects invalid hosted internal AI commands before mutating the room frame", () => {
    const host = createRoomHost({ autoTick: false, aiScripts: [invalidTrainingAiScript()] });
    const room = host.createRoom({ id: "room-invalid-hosted-ai", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);

    expect(() => host.tickRoom(room.id, 1)).toThrow(/Hosted command rejected: townHall cannot train footman/);

    const after = host.snapshot(room.id);
    const enemyTownHall = after.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall");
    expect(after.tick).toBe(0);
    expect(enemyTownHall?.queue).toHaveLength(0);
  });

  it("records replay checkpoints during room ticking for fast seek", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-replay-checkpoint", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.enableDebugReplay(room.id, { id: "trace-room-replay-checkpoint", label: "debug replay checkpoint" });

    host.tickRoom(room.id, 260);

    const recorded = host.readDebugReplay(room.id);
    const checkpoint = recorded.checkpoints.find((candidate) => candidate.tick > 0);
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.snapshot.tick).toBe(checkpoint?.tick);
  });

  it("extracts a debug replay frame into a stored savegame", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-replay-save", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.enableDebugReplay(room.id, { id: "trace-room-replay-save", label: "debug replay save" });
    host.tickRoom(room.id, 40);

    const save = host.extractDebugReplayFrameSave(room.id, 24, { id: "save-from-replay", label: "frame 24" });
    const stored = host.readSave(save.id);

    expect(save.id).toBe("save-from-replay");
    expect(save.label).toBe("frame 24");
    expect(save.snapshot.tick).toBe(24);
    expect(stored).toEqual(save);
  });

  it("keeps debug replay seekable after match cleanup", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-replay-ended", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    resetRoomWithPlayerSiege(host, room.id);

    host.enableDebugReplay(room.id, { id: "trace-ended", label: "post match rewind" });
    host.commandRoom(room.id, "player", playerSiegeAttackCommand());

    const ended = host.tickRoom(room.id, 800);
    const replayedEnd = host.replayDebugToTick(room.id, ended.snapshot.tick);
    const replayedMid = host.replayDebugToTick(room.id, Math.max(1, Math.floor(ended.snapshot.tick / 2)));
    const recorded = host.readDebugReplay(room.id);

    expect(ended.room.status).toBe("ended");
    expect(recorded.frames.some((frame) => frame.source === "browser")).toBe(true);
    expect(replayedEnd.match).toEqual(ended.snapshot.match);
    expect(replayedMid.tick).toBeLessThan(ended.snapshot.tick);
  });

  it("keeps lockstep frame ticking on the same match-finish and replay path", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-frame-ended", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    resetRoomWithPlayerSiege(host, room.id);
    host.enableDebugReplay(room.id, { id: "trace-frame-ended", label: "frame post match rewind" });

    let snapshot = host.snapshot(room.id);
    host.tickRoomFrame(room.id, {
      roomId: room.id,
      tick: snapshot.tick,
      sequence: 0,
      commands: [{ playerId: "player", command: playerSiegeAttackCommand() }],
    });
    for (let sequence = 1; sequence < 800 && host.getRoom(room.id).status === "inMatch"; sequence += 1) {
      snapshot = host.snapshot(room.id);
      host.tickRoomFrame(room.id, { roomId: room.id, tick: snapshot.tick, sequence, commands: [] });
    }

    const ended = host.getRoom(room.id);
    const recorded = host.readDebugReplay(room.id);
    const replayedEnd = host.replayDebugToTick(room.id, ended.result?.endedAtTick ?? 0);

    expect(ended.status).toBe("ended");
    expect(recorded.frames.some((frame) => frame.source === "browser")).toBe(true);
    expect(recorded.checkpoints.some((checkpoint) => checkpoint.snapshot.match.winner === ended.result?.winner)).toBe(true);
    expect(replayedEnd.match.winner).toBe(ended.result?.winner);
  });

  it("keeps active-room auto ticking on the same match-finish and replay path", () => {
    const host = createRoomHost({ aiScripts: [movingEnemyScript()] });
    const room = host.createRoom({ id: "room-autotick-ended", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    resetRoomWithPlayerSiege(host, room.id, { aiPlayers: ["enemy"] });
    host.enableDebugReplay(room.id, { id: "trace-autotick-ended", label: "autotick post match rewind" });
    host.commandRoom(room.id, "player", playerSiegeAttackCommand());

    host.tickActiveRooms(800);

    const ended = host.getRoom(room.id);
    const recorded = host.readDebugReplay(room.id);
    const replayedEnd = host.replayDebugToTick(room.id, ended.result?.endedAtTick ?? 0);

    expect(ended.status).toBe("ended");
    expect(recorded.frames.some((frame) => frame.source === "internal-ai")).toBe(true);
    expect(recorded.checkpoints.some((checkpoint) => checkpoint.snapshot.match.winner === ended.result?.winner)).toBe(true);
    expect(replayedEnd.match.winner).toBe(ended.result?.winner);
  });
});
