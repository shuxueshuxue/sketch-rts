import { describe, expect, it } from "vitest";
import {
  assertCreateRoomInput,
  parseGameSetupOptions,
  parseResetRoomRequest,
  parseSlotPatch,
  parseSlotCountsRequest,
  roomCreateInputFromRequest,
} from "./room-schema";
import { MAP_IDS } from "./map-ids";
import { MAP_SCENARIOS } from "./map";

describe("shared room setup schema", () => {
  it("normalizes create-room requests before room helpers consume them", () => {
    const request = { host: { id: "host", name: "Host" }, mapId: "bareDuel", visibility: "private", humanCount: 1, aiCount: 1 };

    expect(roomCreateInputFromRequest(request, "room-generated")).toEqual({
      id: "room-generated",
      host: { id: "host", name: "Host" },
      mapId: "bareDuel",
      visibility: "private",
      humanCount: 1,
      aiCount: 1,
    });
    expect(assertCreateRoomInput({ ...request, id: "room-static" })).toMatchObject({ id: "room-static", mapId: "bareDuel" });
    expect(() => assertCreateRoomInput({ ...request, id: "room-bad", humanCount: 0 })).toThrow("Malformed room create input");
    expect(() => assertCreateRoomInput({ ...request, id: "room-overflow", humanCount: 30 })).toThrow("Malformed room create input");
  });

  it("parses slot, slot-count, and reset payloads through one runtime contract", () => {
    expect(parseSlotPatch({ controller: "ai", team: "south", race: "ember", ready: false, ignored: true })).toEqual({
      controller: "ai",
      team: "south",
      race: "ember",
      ready: false,
    });
    expect(parseSlotPatch({ controller: "bot" })).toBeUndefined();
    expect(parseSlotCountsRequest({ humanCount: 2, aiCount: 3 })).toEqual({ humanCount: 2, aiCount: 3 });
    expect(parseSlotCountsRequest({ humanCount: 0, aiCount: 3 })).toBeUndefined();
    expect(parseSlotCountsRequest({ humanCount: 30, aiCount: 29 })).toBeUndefined();

    expect(parseResetRoomRequest({ mapId: "bareDuel", options: { aiPlayers: ["enemy"], races: { player: "grove", enemy: "ember" } } })).toEqual({
      mapId: "bareDuel",
      options: { aiPlayers: ["enemy"], races: { player: "grove", enemy: "ember" } },
    });
    expect(parseResetRoomRequest({ mapId: "missing", options: {} })).toBeUndefined();
  });

  it("validates scenario seeds in the same place as reset options", () => {
    expect(
      parseGameSetupOptions({
        scenario: {
          replaceDefaultUnits: true,
          addUnits: [{ id: "unit-a", owner: "neutral", kind: "wildling", x: 10, y: 20, hp: 30 }],
          addBuildings: [{ id: "tower-a", owner: "player", kind: "defenseTower", x: 40, y: 50, hp: 90, maxHp: 120, complete: true }],
        },
      }),
    ).toEqual({
      scenario: {
        replaceDefaultUnits: true,
        addUnits: [{ id: "unit-a", owner: "neutral", kind: "wildling", x: 10, y: 20, hp: 30 }],
        addBuildings: [{ id: "tower-a", owner: "player", kind: "defenseTower", x: 40, y: 50, hp: 90, maxHp: 120, complete: true }],
      },
    });
    expect(parseGameSetupOptions({ scenario: { addUnits: [{ id: "unit-a", owner: "neutral", kind: "wildling", x: 10, y: 20, hp: 9999 }] } })).toBeUndefined();
    expect(parseGameSetupOptions({ scenario: { addBuildings: [{ id: "tower-a", owner: "player", kind: "defenseTower", x: 40, y: 50, hp: 9999 }] } })).toBeUndefined();
  });

  it("uses the same map id set as the visible room setup catalog", () => {
    expect(MAP_SCENARIOS.map((scenario) => scenario.id).sort()).toEqual([...MAP_IDS].sort());
  });
});
