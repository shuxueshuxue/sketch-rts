import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "./sim";
import { canStartRoom, createGrandThirtyRoom, createRoom, finishRoom, joinFirstOpenSlot, roomToGameSetup, updateRoomMap, updateRoomSlot } from "./rooms";
import type { LocalUserProfile } from "./types";

const host: LocalUserProfile = { id: "user-host", name: "Host" };
const guest: LocalUserProfile = { id: "user-guest", name: "Guest" };

describe("room model", () => {
  it("starts solo and LAN matches through the same slot setup contract", () => {
    let room = createRoom({ id: "room-1", host, slotCount: 4 });
    room = updateRoomSlot(room, "slot-2", { controller: "open", name: "Open", ready: false });
    room = updateRoomSlot(room, "slot-3", { controller: "closed" });
    room = updateRoomSlot(room, "slot-4", { controller: "ai", team: "south" });

    expect(canStartRoom(room)).toBe(false);

    room = joinFirstOpenSlot(room, guest);
    room = updateRoomSlot(room, "slot-2", { ready: true, team: "north", race: "ember" });

    expect(canStartRoom(room)).toBe(true);
    const setup = roomToGameSetup(room);
    expect(setup.playerSlots.map((slot) => slot.controller)).toEqual(["human", "human", "ai"]);
    expect(setup.options.players).toEqual(["player", "enemy", "player-4"]);
    expect(setup.options.aiPlayers).toEqual(["player-4"]);
    expect(setup.options.teams).toMatchObject({ player: "north", enemy: "north", "player-4": "south" });
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
    const updated = updateRoomMap(room, "wildMarches");

    expect(updated.mapId).toBe("wildMarches");
    expect(roomToGameSetup(updated).mapId).toBe("wildMarches");
    expect(() => updateRoomMap({ ...updated, status: "inMatch" }, "bareDuel")).toThrow("Cannot edit map after match start");
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
