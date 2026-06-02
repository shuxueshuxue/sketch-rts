import { describe, expect, it } from "vitest";
import { createRoomHost } from "./room-host";
import type { LocalUserProfile } from "../shared/types";

const hostUser: LocalUserProfile = { id: "user-host", name: "Host" };
const guestUser: LocalUserProfile = { id: "user-guest", name: "Guest" };

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

    expect(after.units.find((unit) => unit.id === playerWorker!.id)?.order).toMatchObject({ type: "move" });
    expect(after.units.find((unit) => unit.id === enemyWorker!.id)?.order).toMatchObject({ type: "move" });
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

  it("records debug replay batches from SDK commands and internal AI commands", () => {
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
    expect(recorded.batches.some((batch) => batch.source === "sdk-agent")).toBe(true);
    expect(recorded.batches.some((batch) => batch.source === "internal-ai")).toBe(true);
    expect(replayed.units).toEqual(host.snapshot(room.id).units);
    expect(replayed.buildings).toEqual(host.snapshot(room.id).buildings);
  });

  it("records internal AI batches from the normal active-room tick loop", () => {
    const host = createRoomHost();
    const room = host.createRoom({ id: "room-replay-autotick", host: hostUser, mapId: "bareDuel" });
    host.startRoom(room.id);
    host.enableDebugReplay(room.id, { id: "trace-room-replay-autotick", label: "debug replay autotick" });

    host.tickActiveRooms(60);

    const recorded = host.readDebugReplay(room.id);
    const replayed = host.replayDebugToTick(room.id, host.snapshot(room.id).tick);

    expect(recorded.batches.some((batch) => batch.source === "internal-ai")).toBe(true);
    expect(replayed.units).toEqual(host.snapshot(room.id).units);
    expect(replayed.buildings).toEqual(host.snapshot(room.id).buildings);
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
    host.resetRoom(room.id, "bareDuel", {
      aiPlayers: [],
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

    host.enableDebugReplay(room.id, { id: "trace-ended", label: "post match rewind" });
    host.commandRoom(room.id, "player", {
      type: "attack",
      unitIds: Array.from({ length: 18 }, (_, index) => `replay-siege-${index}`),
      targetId: "building-enemy-townhall",
    });

    const ended = host.tickRoom(room.id, 800);
    const replayedEnd = host.replayDebugToTick(room.id, ended.snapshot.tick);
    const replayedMid = host.replayDebugToTick(room.id, Math.max(1, Math.floor(ended.snapshot.tick / 2)));
    const recorded = host.readDebugReplay(room.id);

    expect(ended.room.status).toBe("ended");
    expect(recorded.batches.some((batch) => batch.source === "browser")).toBe(true);
    expect(replayedEnd.match).toEqual(ended.snapshot.match);
    expect(replayedMid.tick).toBeLessThan(ended.snapshot.tick);
  });
});
