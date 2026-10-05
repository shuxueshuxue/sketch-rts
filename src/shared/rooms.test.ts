import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "./sim";
import { canStartRoom, createGrandThirtyRoom, createRoom, finishRoom, joinFirstOpenSlot, lobbyVisibleRooms, resizeRoomSlots, ROOM_AI_RACES, ROOM_AI_VERSIONS, roomAiVersionsFor, roomToGameSetup, updateRoomMap, updateRoomSlot } from "./rooms";
import { createRoomLifecycleHost } from "./room-lifecycle";
import { parseSlotPatch } from "./room-schema";
import type { LocalUserProfile } from "./types";

const host: LocalUserProfile = { id: "user-host", name: "Host" };
const guest: LocalUserProfile = { id: "user-guest", name: "Guest" };

describe("room model", () => {
  it("starts solo and LAN matches through the same slot setup contract", () => {
    let room = createRoom({ id: "room-1", host, slotCount: 4 });
    room = updateRoomSlot(room, "slot-2", { controller: "open", name: "Open", ready: false });
    room = updateRoomSlot(room, "slot-3", { controller: "closed" });
    room = updateRoomSlot(room, "slot-4", { controller: "ai", team: "team-2" });

    expect(canStartRoom(room)).toBe(false);

    room = joinFirstOpenSlot(room, guest);
    room = updateRoomSlot(room, "slot-1", { team: "team-1" });
    room = updateRoomSlot(room, "slot-2", { ready: true, team: "team-1", race: "ember" });

    expect(canStartRoom(room)).toBe(true);
    const setup = roomToGameSetup(room);
    expect(setup.playerSlots.map((slot) => slot.controller)).toEqual(["human", "human", "ai"]);
    expect(setup.options.players).toEqual(["player", "enemy", "player-4"]);
    expect(setup.options.aiPlayers).toEqual(["player-4"]);
    // A computer seat starts on random: a computer player drawn for it (see the random seats below).
    expect(ROOM_AI_VERSIONS).toContain(setup.options.aiVersions?.["player-4"]);
    expect(setup.options.teams).toEqual({ player: "team-1", enemy: "team-1", "player-4": "team-2" });
  });

  it("starts each AI slot with the computer player chosen for it, V5 when none is", () => {
    let room = createRoom({ id: "room-ai-versions", host, slotCount: 4 });
    room = updateRoomSlot(room, "slot-2", { controller: "ai", team: "team-2", race: "grove", aiVersion: "v8" });
    room = updateRoomSlot(room, "slot-3", { controller: "ai", team: "team-2", race: "ember", aiVersion: "v7" });
    // A room from before random seats: a computer seat with no computer player set.
    room = { ...room, slots: room.slots.map((slot) => (slot.id === "slot-4" ? { id: slot.id, playerId: slot.playerId, controller: "ai" as const, name: "AI", team: "team-2", race: "grove" as const, ready: true } : slot)) };
    expect(roomToGameSetup(room).options.aiVersions).toEqual({ enemy: "v8", enemy2: "v7", "player-4": "v5" });
  });

  it("draws a random seat's race, then a computer player that plays it, the same at every start and in the result", () => {
    let room = createRoom({ id: "room-random-seats", host, slotCount: 4 });
    expect(room.slots.slice(1).map((slot) => [slot.race, slot.aiVersion])).toEqual([
      ["random", "random"],
      ["random", "random"],
      ["random", "random"],
    ]);
    room = updateRoomSlot(room, "slot-1", { race: "random" });
    const setup = roomToGameSetup(room);
    for (const slot of setup.playerSlots) {
      expect(["grove", "ember"]).toContain(setup.options.races?.[slot.playerId]);
      if (slot.controller === "ai") expect(roomAiVersionsFor(slot.race)).toContain(setup.options.aiVersions?.[slot.playerId]);
    }
    expect(roomToGameSetup(room)).toEqual(setup);
    // Different rooms draw differently: over a dozen rooms both races come up.
    const races = new Set(Array.from({ length: 12 }, (_, i) => roomToGameSetup(createRoom({ id: `room-draw-${i}`, host, slotCount: 2 })).options.races?.enemy));
    expect(races).toEqual(new Set(["grove", "ember"]));

    const result = finishRoom({ ...room, status: "inMatch" }, snapshotGame(createGame("bareDuel", { aiPlayers: [] }))).result!;
    expect(result.slots.map((slot) => [slot.race, slot.aiVersion])).toEqual(setup.playerSlots.map((slot) => [slot.race, slot.aiVersion]));
    // A player's seat plays no computer player.
    expect(result.slots[0]).not.toHaveProperty("aiVersion");
    expect(Object.keys(setup.options.aiVersions ?? {})).toEqual(["enemy", "enemy2", "player-4"]);
  });

  it("locks a computer seat on a random race to a random computer player, and refuses one that does not play its race", () => {
    let room = createRoom({ id: "room-ai-race", host, slotCount: 2 });
    room = updateRoomSlot(room, "slot-2", { race: "random", aiVersion: "v8" });
    expect(room.slots[1]!.aiVersion).toBe("random");
    room = updateRoomSlot(room, "slot-2", { race: "ember", aiVersion: "v8" });
    expect(room.slots[1]!.aiVersion).toBe("v8");

    const declared = ROOM_AI_RACES.v5;
    (ROOM_AI_RACES as Record<string, readonly string[]>).v5 = ["grove"];
    try {
      expect(roomAiVersionsFor("ember")).not.toContain("v5");
      expect(() => updateRoomSlot(room, "slot-2", { race: "ember", aiVersion: "v5" })).toThrow("v5 does not play ember");
    } finally {
      (ROOM_AI_RACES as Record<string, readonly string[]>).v5 = declared;
    }
  });

  it("takes random for a seat's race and computer player from a client, and nothing else unknown", () => {
    expect(parseSlotPatch({ race: "random", aiVersion: "random" })).toEqual({ race: "random", aiVersion: "random" });
    expect(parseSlotPatch({ race: "orc" })).toBeUndefined();
    expect(parseSlotPatch({ aiVersion: "v9" })).toBeUndefined();
  });

  it("lets the same local user rejoin their claimed slot without requiring an open slot", () => {
    const room = createRoom({ id: "room-rejoin", host, slotCount: 2 });

    const rejoined = joinFirstOpenSlot(room, host);

    expect(rejoined).toEqual(room);
    expect(rejoined.slots.find((slot) => slot.userId === host.id)?.playerId).toBe("player");
  });

  it("only lets claimed players re-enter a room after match start", () => {
    const started = { ...createRoom({ id: "room-started", host, slotCount: 2 }), status: "inMatch" as const };

    expect(joinFirstOpenSlot(started, host)).toEqual(started);
    expect(() => joinFirstOpenSlot(started, guest)).toThrow("Cannot join after match start");
  });

  it("creates private or public rooms with requested human and computer slot counts", () => {
    const room = createRoom({ id: "room-counts", host, mapId: "bareDuel", visibility: "private", humanCount: 3, aiCount: 2 });

    expect(room.visibility).toBe("private");
    expect(room.mapId).toBe("bareDuel");
    expect(room.slots).toHaveLength(5);
    expect(room.slots.filter((slot) => slot.controller === "human")).toHaveLength(1);
    expect(room.slots.filter((slot) => slot.controller === "open")).toHaveLength(2);
    expect(room.slots.filter((slot) => slot.controller === "ai")).toHaveLength(2);
    expect(room.slots[0]).toMatchObject({ controller: "human", userId: host.id, ready: true });
  });

  it("resizes an open room from the setup screen without tying slot count to the map", () => {
    let room = createRoom({ id: "room-resize", host, mapId: "grandThirty" });

    room = resizeRoomSlots(room, 4, 3);

    expect(room.mapId).toBe("grandThirty");
    expect(room.slots).toHaveLength(7);
    expect(room.slots[0]).toMatchObject({ controller: "human", userId: host.id, name: "Host" });
    expect(room.slots.slice(1, 4).map((slot) => slot.controller)).toEqual(["open", "open", "open"]);
    expect(room.slots.slice(4).map((slot) => slot.controller)).toEqual(["ai", "ai", "ai"]);
    expect(room.slots.map((slot) => slot.playerId)).toEqual(["player", "enemy", "enemy2", "player-4", "player-5", "player-6", "player-7"]);
  });

  it("defaults all-human rooms to free for all, startable after every human slot is claimed", () => {
    let room = createRoom({ id: "room-all-human", host, humanCount: 2, aiCount: 0 });

    room = joinFirstOpenSlot(room, guest);
    room = updateRoomSlot(room, "slot-2", { ready: true });

    expect(room.slots.map((slot) => slot.team)).toEqual(["ffa", "ffa"]);
    expect(canStartRoom(room)).toBe(true);
  });

  it("seats free for all by default, each seat its own team, and a map of two sides on teams 1 and 2 by turns", () => {
    let room = createRoom({ id: "room-ffa", host, humanCount: 1, aiCount: 3 });
    expect(room.slots.map((slot) => slot.team)).toEqual(["ffa", "ffa", "ffa", "ffa"]);
    expect(roomToGameSetup(room).options.teams).toEqual({ player: "player", enemy: "enemy", enemy2: "enemy2", "player-4": "player-4" });
    // Two on a team, two free for all: three sides.
    room = updateRoomSlot(updateRoomSlot(room, "slot-1", { team: "team-1" }), "slot-2", { team: "team-1" });
    expect(roomToGameSetup(room).options.teams).toEqual({ player: "team-1", enemy: "team-1", enemy2: "enemy2", "player-4": "player-4" });
    // All on one team: nobody to play.
    for (const slot of ["slot-3", "slot-4"]) room = updateRoomSlot(room, slot, { team: "team-1" });
    expect(canStartRoom(room)).toBe(false);

    const sides = createRoom({ id: "room-two-sides", host, mapId: "stillwater", humanCount: 1, aiCount: 3 });
    expect(sides.slots.map((slot) => slot.team)).toEqual(["team-1", "team-2", "team-1", "team-2"]);
    expect(canStartRoom(sides)).toBe(true);
    expect(canStartRoom(sides.slots.reduce((edited, slot) => updateRoomSlot(edited, slot.id, { team: "ffa" }), sides))).toBe(true);
  });

  it("reads the north, south, east and west of rooms and saves from before as teams 1 to 4", () => {
    const room = updateRoomSlot(createRoom({ id: "room-compass", host, humanCount: 1, aiCount: 3 }), "slot-2", { team: "south" });
    expect(room.slots[1]!.team).toBe("team-2");
    const saved = { ...room, status: "inMatch" as const, slots: room.slots.map((slot, index) => ({ ...slot, team: ["north", "south", "east", "west"][index]! })) };
    const adopted = createRoomLifecycleHost().adoptRoom(saved);
    expect(adopted.slots.map((slot) => slot.team)).toEqual(["team-1", "team-2", "team-3", "team-4"]);
  });

  it("keeps private rooms out of the public lobby while preserving owner visibility", () => {
    const privateRoom = createRoom({ id: "room-private", host, visibility: "private" });
    const publicRoom = createRoom({ id: "room-public", host: guest, visibility: "public" });

    expect(lobbyVisibleRooms([privateRoom, publicRoom]).map((room) => room.id)).toEqual(["room-public"]);
    expect(lobbyVisibleRooms([privateRoom, publicRoom], host.id).map((room) => room.id)).toEqual(["room-private", "room-public"]);
  });

  it("keeps public in-match rooms visible for spectators without exposing private matches", () => {
    const publicMatch = { ...createRoom({ id: "room-public-match", host, visibility: "public" }), status: "inMatch" as const };
    const privateMatch = { ...createRoom({ id: "room-private-match", host, visibility: "private" }), status: "inMatch" as const };

    expect(lobbyVisibleRooms([publicMatch, privateMatch], guest.id).map((room) => room.id)).toEqual(["room-public-match"]);
    expect(lobbyVisibleRooms([privateMatch], host.id).map((room) => room.id)).toEqual(["room-private-match"]);
  });

  it("does not keep open or closed placeholder names when a slot becomes AI", () => {
    let room = createRoom({ id: "room-slot-name", host });

    room = updateRoomSlot(room, "slot-2", { controller: "open" });
    expect(room.slots[1]?.name).toBe("Open");
    room = updateRoomSlot(room, "slot-2", { controller: "ai" });
    expect(room.slots[1]).toMatchObject({ controller: "ai", name: "AI", ready: true });

    room = updateRoomSlot(room, "slot-2", { controller: "closed" });
    expect(room.slots[1]?.name).toBe("Closed");
    room = updateRoomSlot(room, "slot-2", { controller: "ai" });
    expect(room.slots[1]).toMatchObject({ controller: "ai", name: "AI", ready: true });
  });

  it("keeps 15 SDK-driven human slots distinct from 15 internal AI slots", () => {
    const room = createGrandThirtyRoom("grand", host);
    const setup = roomToGameSetup(room);

    expect(setup.mapId).toBe("grandThirty");
    expect(setup.playerSlots).toHaveLength(30);
    expect(setup.playerSlots.filter((slot) => slot.controller === "human")).toHaveLength(15);
    expect(setup.playerSlots.filter((slot) => slot.controller === "ai")).toHaveLength(15);
    expect(setup.options.players).toHaveLength(30);
    expect(setup.options.aiPlayers).toHaveLength(15);
    expect(setup.options.aiVersions?.["ai-1"]).toBe("v5");
    expect(setup.options.players?.slice(0, 3)).toEqual(["human-1", "human-2", "human-3"]);
    expect(setup.options.aiPlayers?.slice(0, 3)).toEqual(["ai-1", "ai-2", "ai-3"]);
  });

  it("can create asymmetric grand stress rooms without changing controller semantics", () => {
    const humanHeavy = createGrandThirtyRoom("grand-human-heavy", host, { humanCount: 20, aiCount: 10 });
    const aiHeavy = createGrandThirtyRoom("grand-ai-heavy", host, { humanCount: 10, aiCount: 20 });

    const humanHeavySetup = roomToGameSetup(humanHeavy);
    const aiHeavySetup = roomToGameSetup(aiHeavy);

    expect(humanHeavySetup.playerSlots.filter((slot) => slot.controller === "human")).toHaveLength(20);
    expect(humanHeavySetup.playerSlots.filter((slot) => slot.controller === "ai")).toHaveLength(10);
    expect(humanHeavySetup.options.aiPlayers).toHaveLength(10);
    expect(aiHeavySetup.playerSlots.filter((slot) => slot.controller === "human")).toHaveLength(10);
    expect(aiHeavySetup.playerSlots.filter((slot) => slot.controller === "ai")).toHaveLength(20);
    expect(aiHeavySetup.options.aiPlayers).toHaveLength(20);
  });

  it("keeps map choice as editable room setup state before match start", () => {
    const room = createRoom({ id: "room-map", host });
    const updated = updateRoomMap(room, "campRush");

    expect(updated.mapId).toBe("campRush");
    expect(roomToGameSetup(updated).mapId).toBe("campRush");
    expect(() => updateRoomMap({ ...updated, status: "inMatch" }, "bareDuel")).toThrow("Cannot edit map after match start");
  });

  it("plays a ladder room on the layout its id seeds, and any other map on its own", () => {
    const ladder = createRoom({ id: "room-ladder", host, mapId: "ladder" });
    expect(roomToGameSetup(ladder)).toMatchObject({ mapId: "ladder", options: { layout: { seed: "room-ladder" } } });
    expect(roomToGameSetup(updateRoomMap(ladder, "verdantCrossroads")).options.layout).toBeUndefined();
    expect(roomToGameSetup(updateRoomMap(ladder, "pineshade")).options.layout).toBeUndefined();
  });

  it("starts a full pool map with custom alliances, including two-shore maps", () => {
    const duel = createRoom({ id: "room-duel", host, mapId: "pineshade", humanCount: 1, aiCount: 1 });
    expect(canStartRoom(duel)).toBe(true);
    expect(canStartRoom(createRoom({ id: "room-crowd", host, mapId: "pineshade", humanCount: 1, aiCount: 2 }))).toBe(false);
    const sides = createRoom({ id: "room-sides", host, mapId: "twoShores", humanCount: 1, aiCount: 3 });
    expect(canStartRoom(sides)).toBe(true);
    expect(canStartRoom(updateRoomSlot(sides, "slot-2", { team: "team-1" }))).toBe(true);
    const ring = createRoom({ id: "room-ring", host, mapId: "elderwood", humanCount: 1, aiCount: 3 });
    expect(canStartRoom(updateRoomSlot(ring, "slot-2", { team: "team-3" }))).toBe(true);
    expect(canStartRoom(updateRoomSlot(ring, "slot-4", { controller: "closed" }))).toBe(false);
  });

  it("records immutable match results from the simulation snapshot", () => {
    const room = createRoom({ id: "room-results", host });
    const game = createGame(room.mapId, roomToGameSetup(room).options);
    game.match.winner = "player";
    game.match.endedAtTick = 1234;

    const ended = finishRoom(room, snapshotGame(game));

    expect(ended.status).toBe("ended");
    expect(ended.result?.winner).toBe("player");
    expect(ended.result?.endedAtTick).toBe(1234);
    expect(ended.result?.slots.map((slot) => slot.id)).toEqual(["slot-1", "slot-2"]);
  });
});
