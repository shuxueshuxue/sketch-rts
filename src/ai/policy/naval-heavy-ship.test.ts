import { describe, expect, it } from "vitest";
import { createBuilding } from "../../shared/map";
import { combatCapability } from "../../shared/combat-capabilities";
import { hullFits } from "../../shared/ship-navigation";
import { installedWeapons } from "../../shared/ship-equipment";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../../shared/sim";
import { seconds } from "../../shared/time";
import { createAiPolicyMemory } from "../memory";
import { navalUnitIds, navalWant, planNavalTactics } from "./naval";

function coastFleet() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = [];
  game.map.width = game.map.height = 4000;
  game.map.terrain = { cell: 40, cols: 100, rows: 100, cells: (".".repeat(25) + "~".repeat(75)).repeat(100) };
  game.scriptedVictory = true;
  game.players.player!.gold = 5000;
  game.buildings.push(createBuilding("heavy-dock", "player", "shipyard", 1000, 1000, true));
  for (let index = 0; index < 6; index++) game.spawnUnit("player", "footman", 800, 600 + index * 40);
  return game;
}

describe("heavy broadside ships in shared naval policy", () => {
  it("buys and installs the remaining four guns at the dock without creating crew or extra mounts", () => {
    const game = coastFleet(), ship = game.spawnUnit("player", "shipOfTheLine", 1200, 1000);
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    expect(installedWeapons(game, ship)).toHaveLength(4);
    expect(navalUnitIds(snapshotGame(game), "player", options).has(ship.id)).toBe(true);
    const gold = game.players.player!.gold;
    for (let tick = 0; tick < seconds(20) && installedWeapons(game, ship).length < 8; tick++) {
      const want = navalWant(snapshotGame(game), "player", options);
      if (want?.id === "naval:gun") {
        const command = want.issue(new Set());
        if (command) issuePlayerCommand(game, "player", command);
      }
      for (const command of planNavalTactics(snapshotGame(game), "player", options)) issuePlayerCommand(game, "player", command);
      stepGame(game);
      expect(hullFits(game.map, ship)).toBe(true);
    }
    const guns = installedWeapons(game, ship);
    expect(guns).toHaveLength(8);
    expect(new Set(guns.map(gun => gun.mountId)).size).toBe(8);
    expect(game.players.player!.gold).toBe(gold - 4 * 220);
    expect(game.units.some(unit => unit.kind === "worker")).toBe(false);
    expect(navalWant(snapshotGame(game), "player", options)?.id).not.toBe("naval:gun");
  });

  it("counts its real battery and assigns it to an engagement with a nearby enemy ship", () => {
    const game = coastFleet(), ship = game.spawnUnit("player", "shipOfTheLine", 1600, 1000);
    const enemy = game.spawnUnit("enemy", "warship", 1600, 1300);
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const snapshot = snapshotGame(game);
    expect(combatCapability(snapshot, ship)).toEqual({ armed: true, range: 312, dps: 40 });
    expect(navalUnitIds(snapshot, "player", options).has(ship.id)).toBe(true);
    const commands = planNavalTactics(snapshot, "player", options);
    expect(commands).toContainEqual({ type: "attackMove", unitIds: [ship.id], x: enemy.x, y: enemy.y });
    for (const command of commands) issuePlayerCommand(game, "player", command);
    const hp = enemy.hp;
    for (let tick = 0; tick < seconds(8) && enemy.hp === hp; tick++) stepGame(game);
    expect(enemy.hp).toBeLessThan(hp);
  });
});
