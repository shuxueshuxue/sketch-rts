import { describe, expect, it } from "vitest";
import { configurationOnMap, defaultRoomConfiguration, formatRoomRoute, parseRoomRoute } from "./room-route";
import { createRoom, roomToGameSetup } from "../shared/rooms";
import { createGame } from "../shared/sim";

describe("address-bar routes", () => {
  it("round-trips room ids using one query router", () => {
    expect(parseRoomRoute(formatRoomRoute({ screen: "room", roomId: "room public/1" }))).toEqual({ screen: "room", roomId: "room public/1" });
    expect(parseRoomRoute(formatRoomRoute({ screen: "profile" }))).toEqual({ screen: "profile" });
    expect(parseRoomRoute("")).toEqual({ screen: "home" });
  });
  it("restores the complete shareable setup configuration, without user identity", () => {
    const configuration = defaultRoomConfiguration("stillwater");
    configuration.name = "陆海练习 & 合作";
    configuration.layoutSeed = "same world";
    configuration.visibility = "public";
    configuration.seatSetup[1] = { controller: "open", race: "ember", team: "team-2" };
    configuration.seatSetup[2] = { controller: "ai", race: "grove", aiVersion: "v9_knight", team: "team-1" };
    const url = formatRoomRoute({ screen: "setup", configuration });
    expect(parseRoomRoute(url)).toEqual({ screen: "setup", configuration });
    expect(url).not.toContain("userId");
    expect(url).not.toContain("ready");
  });
  it("opens a map directly with its default full roster", () => {
    const route = parseRoomRoute("?map=grandEstuary");
    expect(route).toEqual({ screen: "setup", configuration: defaultRoomConfiguration("grandEstuary") });
  });
  it("opens an address from the former map step on the setup, with the same configuration", () => {
    const configuration = defaultRoomConfiguration("grandEstuary");
    configuration.seatSetup[1] = { controller: "ai", race: "ember", team: "team-2", aiVersion: "v9_summoner" };
    const setup = formatRoomRoute({ screen: "setup", configuration });
    expect(parseRoomRoute(`${setup}&view=maps`)).toEqual({ screen: "setup", configuration });
  });
  it("moves a configuration to another map keeping each seat the map has, and its teams only on a map laid out the same way", () => {
    const configuration = defaultRoomConfiguration("stillwater");
    configuration.seatSetup[0] = { ...configuration.seatSetup[0]!, race: "ember" };
    configuration.seatSetup[1] = { controller: "ai", race: "grove", team: configuration.seatSetup[1]!.team, aiVersion: "v9_knight" };
    const larger = configurationOnMap(configuration, "grandEstuary"), fresh = defaultRoomConfiguration("grandEstuary");
    expect(larger.mapId).toBe("grandEstuary"); expect(larger.layoutSeed).toBe(fresh.layoutSeed);
    expect(larger.seatSetup).toHaveLength(8);
    expect(larger.seatSetup[0]).toMatchObject({ controller: "human", race: "ember" });
    expect(larger.seatSetup[1]).toMatchObject({ controller: "ai", race: "grove", aiVersion: "v9_knight" });
    expect(larger.seatSetup.slice(4)).toEqual(fresh.seatSetup.slice(4));
    expect(parseRoomRoute(formatRoomRoute({ screen: "setup", configuration: larger }))).toEqual({ screen: "setup", configuration: larger });
    const back = configurationOnMap(larger, "stillwater");
    expect(back.seatSetup).toHaveLength(4); expect(back.seatSetup[1]).toMatchObject({ race: "grove", aiVersion: "v9_knight" });
    // From two sides to a ring of free-for-all starts and back: the ring's teams, then the sides' own again.
    const ring = configurationOnMap(back, "brokenSea"), sides = configurationOnMap(ring, "stillwater");
    expect(ring.seatSetup.map(seat => seat.team)).toEqual(defaultRoomConfiguration("brokenSea").seatSetup.map(seat => seat.team));
    expect(ring.seatSetup[1]).toMatchObject({ race: "grove", aiVersion: "v9_knight" });
    expect(sides.seatSetup.map(seat => seat.team)).toEqual(defaultRoomConfiguration("stillwater").seatSetup.map(seat => seat.team));
  });
  it("rejects invalid or oversized setups without a partial configuration", () => {
    for (const search of ["?map=missing", "?map=stillwater&seats=ai:ffa:grove:v9_knight", "?map=stillwater&seed=", "?map=stillwater&visibility=bad", "?map=stillwater&seats=human:ffa:unknown:"]) {
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
