import { describe, expect, it } from "vitest";
import { defaultRoomConfiguration, formatRoomRoute, parseRoomRoute } from "./room-route";
import { createRoom, roomToGameSetup } from "../shared/rooms";
import { createGame } from "../shared/sim";

describe("address-bar routes", () => {
  it("round-trips room ids using one query router", () => {
    expect(parseRoomRoute(formatRoomRoute({ screen: "room", roomId: "room public/1" }))).toEqual({ screen: "room", roomId: "room public/1" });
    expect(parseRoomRoute(formatRoomRoute({ screen: "profile" }))).toEqual({ screen: "profile" });
    expect(parseRoomRoute("")).toEqual({ screen: "home" });
  });
  it("restores the complete pre-creation setup, without user identity", () => {
    const configuration = defaultRoomConfiguration("stillwater");
    configuration.name = "陆海练习 & 合作";
    configuration.layoutSeed = "same world";
    configuration.visibility = "public";
    configuration.seatSetup[1] = { controller: "open", race: "ember", team: "team-2" };
    configuration.seatSetup[2] = { controller: "ai", race: "grove", aiVersion: "v8", team: "team-1" };
    const url = formatRoomRoute({ screen: "create", configuration });
    expect(parseRoomRoute(url)).toEqual({ screen: "create", configuration });
    expect(url).not.toContain("userId");
    expect(url).not.toContain("ready");
  });
  it("opens a map directly with its default full roster", () => {
    const route = parseRoomRoute("?map=grandEstuary");
    expect(route).toEqual({ screen: "create", configuration: defaultRoomConfiguration("grandEstuary") });
  });
  it("rejects invalid or oversized setups without a partial configuration", () => {
    for (const search of ["?map=missing", "?map=stillwater&seats=ai:ffa:grove:v8", "?map=stillwater&seed=", "?map=stillwater&visibility=bad", "?map=stillwater&seats=human:ffa:unknown:"]) {
      expect(parseRoomRoute(search)).toEqual({ screen: "home" });
    }
  });
  it("creates the same terrain and random races from a shared seed in different rooms", () => {
    const configuration = defaultRoomConfiguration("stillwater");
    const games = ["one", "two"].map(id => {
      const room = createRoom({ id, host: { id, name: id }, ...configuration, humanCount: 1, aiCount: 3 });
      const setup = roomToGameSetup(room);
      return { races: setup.playerSlots.map(slot => [slot.race, slot.aiVersion]), game: createGame(setup.mapId, setup.options) };
    });
    expect(games[0]!.races).toEqual(games[1]!.races);
    expect(games[0]!.game.map).toEqual(games[1]!.game.map);
  });
});
