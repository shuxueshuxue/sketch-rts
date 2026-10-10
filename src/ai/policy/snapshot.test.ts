import { describe, expect, it } from "vitest";
import { createUnit } from "../../shared/map";
import { createGame, snapshotGame } from "../../shared/sim";
import { enemyBuildings, enemyCombatUnits, enemyUnits, enemyWorkers, neutralUnits } from "./snapshot";

function scene() {
  const game = createGame("bareDuel", { players: ["player", "enemy", "enemy2"], aiPlayers: [] });
  game.units = [
    createUnit("foe-soldier", "enemy", "footman", 900, 900),
    createUnit("foe-worker", "enemy", "worker", 950, 900),
    createUnit("third-soldier", "enemy2", "footman", 1100, 1100),
    createUnit("third-worker", "enemy2", "worker", 1150, 1100),
    createUnit("camp", "neutral", "wildling", 1200, 1200),
  ];
  return snapshotGame(game);
}

describe("AI snapshot list isolation", () => {
  it("keeps every selected list independent after callers sort or remove entries", () => {
    const snapshot = scene();
    const reads = [enemyUnits, enemyCombatUnits, enemyWorkers, neutralUnits, enemyBuildings];
    for (const read of reads) {
      const original = read(snapshot, "player").map(entity => entity.id);
      expect(original.length).toBeGreaterThan(0);
      const mutated = read(snapshot, "player");
      mutated.reverse();
      mutated.splice(0, mutated.length);
      expect(read(snapshot, "player").map(entity => entity.id)).toEqual(original);
      expect(read(snapshot, "player")).not.toBe(mutated);
    }
    expect(enemyUnits(snapshot, "player").map(unit => unit.id)).toEqual([
      "foe-soldier", "foe-worker", "third-soldier", "third-worker",
    ]);
  });

  it("separates owners and team overrides within the same snapshot", () => {
    const snapshot = scene();
    const teams = { player: "north", enemy: "north", enemy2: "south" };
    expect(enemyUnits(snapshot, "player", teams).map(unit => unit.id)).toEqual(["third-soldier", "third-worker"]);
    expect(enemyUnits(snapshot, "enemy2", teams).map(unit => unit.id)).toEqual(["foe-soldier", "foe-worker"]);
    expect(enemyUnits(snapshot, "player")).toHaveLength(4);
    expect(enemyWorkers(snapshot, "player", teams).map(unit => unit.id)).toEqual(["third-worker"]);
    expect(enemyUnits(snapshot, "player", teams)).toHaveLength(2);
  });

  it("rebuilds its view for a new snapshot after ownership changes", () => {
    const first = scene();
    expect(enemyUnits(first, "player")).toHaveLength(4);
    const next = structuredClone(first);
    next.tick += 1;
    next.units[0]!.owner = "player";
    expect(enemyUnits(next, "player").map(unit => unit.id)).toEqual(["foe-worker", "third-soldier", "third-worker"]);
    expect(enemyUnits(first, "player")).toHaveLength(4);
  });
});
