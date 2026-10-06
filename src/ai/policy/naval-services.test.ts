import { describe, expect, it } from "vitest";
import {
  createGame,
  issuePlayerCommand,
  snapshotGame,
  stepGame,
} from "../../shared/sim";
import { boardUnit, syncDecks } from "../../shared/decks";
import { seconds } from "../../shared/time";
import { combatCapability } from "../../shared/combat-capabilities";
import { installedWeapons } from "../../shared/ship-equipment";
import { createAiPolicyMemory } from "../memory";
import { navalServices } from "./naval-services";
import { fleetStations } from "./fleet-formation";

function sea() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = [];
  game.buildings = [];
  game.resources = [];
  game.map.terrain = {
    cell: 40,
    cols: 100,
    rows: 100,
    cells: "~".repeat(10000),
  };
  game.map.width = game.map.height = 4000;
  game.scriptedVictory = true;
  game.players.player!.gold = 3000;
  return game;
}
describe("physical naval service tasks", () => {
  for (const version of ["v5", "v7", "v8"] as const) {
    it(`${version} sends a repair worker across decks and the shared simulation repairs the hull`, () => {
      const game = sea(),
        source = game.spawnUnit("player", "warship", 900, 900),
        target = game.spawnUnit("player", "warship", 1160, 900);
      const worker = game.spawnUnit("player", "worker", 900, 900);
      expect(boardUnit(source, worker, game.units)).toBe(true);
      syncDecks(game.units);
      target.order = { type: "move", x: 1400, y: 1100 };
      target.hp = Math.floor(target.maxHp * 0.45);
      const before = target.hp;
      const options = { version, memory: createAiPolicyMemory() };
      const service = navalServices(snapshotGame(game), "player", options);
      expect(service.reserved).toEqual(
        new Set([source.id, target.id, worker.id]),
      );
      for (const command of service.commands)
        issuePlayerCommand(game, "player", command);
      for (let tick = 0; tick < seconds(35); tick++) stepGame(game);
      expect(worker.deck?.shipId).toBe(target.id);
      expect(target.hp).toBeGreaterThan(before);
    });
    it(`${version} captures an empty enemy hull without its own automatic guns sinking the prize`, () => {
      const game = sea(),
        source = game.spawnUnit("player", "warship", 900, 900),
        prize = game.spawnUnit("enemy", "transport", 1160, 900);
      prize.hp = 60;
      const crew = game.spawnUnit("player", "footman", 900, 900);
      expect(boardUnit(source, crew, game.units)).toBe(true);
      syncDecks(game.units);
      const service = navalServices(snapshotGame(game), "player", {
        version,
        memory: createAiPolicyMemory(),
      });
      expect(service.commands).toContainEqual({
        type: "board",
        unitIds: [crew.id],
        transportId: prize.id,
      });
      for (const command of service.commands)
        issuePlayerCommand(game, "player", command);
      for (let tick = 0; tick < seconds(35) && prize.owner !== "player"; tick++)
        stepGame(game);
      expect(game.units).toContain(prize);
      expect(prize.owner).toBe("player");
      expect(crew.deck?.shipId).toBe(prize.id);
    });
  }
  it("honors an explicit player attack on a hull being boarded", () => {
    const game = sea(),
      ship = game.spawnUnit("player", "warship", 900, 900),
      prize = game.spawnUnit("enemy", "transport", 1150, 900),
      crew = game.spawnUnit("player", "footman", 900, 900);
    boardUnit(ship, crew, game.units);
    syncDecks(game.units);
    crew.order = { type: "board", transportId: prize.id };
    const hp = prize.hp;
    issuePlayerCommand(game, "player", {
      type: "attack",
      unitIds: [ship.id],
      targetId: prize.id,
    });
    for (let tick = 0; tick < seconds(3); tick++) stepGame(game);
    expect(prize.hp).toBeLessThan(hp);
  });
  it("counts working mounted guns, with no phantom attack from an unarmed hull", () => {
    const game = sea(),
      hull = game.spawnUnit("player", "transport", 900, 900),
      fighter = game.spawnUnit("player", "warship", 1300, 900);
    expect(combatCapability(snapshotGame(game), hull)).toEqual({
      armed: false,
      range: 0,
      dps: 0,
    });
    const gun = installedWeapons(game, fighter)[0]!,
      dps = combatCapability(snapshotGame(game), fighter).dps;
    game.items.push({ ...gun, id: "second", mountId: "port0" });
    expect(combatCapability(snapshotGame(game), fighter).dps).toBe(dps * 2);
    gun.durability = 0;
    expect(combatCapability(snapshotGame(game), fighter).dps).toBe(dps);
  });
  it("gathers separated ships, launches together and does not restart on every command", () => {
    const game = sea(),
      fleet = [900, 1700, 2500].map((x) =>
        game.spawnUnit("player", "warship", x, 900),
      );
    const memory = {},
      goal = { x: 3000, y: 3000 };
    const stations = fleetStations(snapshotGame(game), fleet, goal, memory);
    expect(stations.size).toBe(3);
    expect(
      new Set([...stations.values()].map((p) => `${p.x},${p.y}`)).size,
    ).toBe(3);
    const state = memory as import("../memory").NavalPlanMemory;
    expect(state.muster?.launched).toBe(false);
    for (const ship of fleet) {
      ship.x = 1700;
      ship.y = 900;
    }
    game.tick += seconds(5);
    fleetStations(snapshotGame(game), fleet, goal, state);
    expect(state.muster?.launched).toBe(true);
    expect(state.muster?.sinceTick).toBe(0);
  });
});
