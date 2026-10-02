import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
import { hasAlly, pointerTarget, relationTo, targetCommand } from "./relations";
import type { GameSnapshot, Unit } from "../shared/types";

// The player and "enemy" on one team, "enemy2" on the other.
function alliedGame() {
  const game = createGame("verdantCrossroads", { players: ["player", "enemy", "enemy2"], aiPlayers: [], teams: { player: "north", enemy: "north", enemy2: "south" } });
  const own = game.spawnUnit("player", "footman", 600, 600);
  const ally = game.spawnUnit("enemy", "footman", 800, 600);
  const foe = game.spawnUnit("enemy2", "footman", 1000, 600);
  return { game, own, ally, foe };
}

// What a right-click there orders the player's selection (see @@@pointer-target and @@@context-target); none is a move.
function rightClick(snapshot: GameSnapshot, selected: Unit[], at: { x: number; y: number }, queued = false) {
  const target = pointerTarget(snapshot, at);
  return target && target.kind !== "item" ? targetCommand(snapshot, "player", selected, target, queued) : undefined;
}

describe("right-click orders", () => {
  it("follows an ally's unit and attacks an enemy's, as in Warcraft III; an own unit is a move", () => {
    const { game, own, ally, foe } = alliedGame();
    const snapshot = snapshotGame(game);
    expect(rightClick(snapshot, [own], ally, true)).toEqual({ type: "follow", unitIds: [own.id], targetId: ally.id, queued: true });
    expect(rightClick(snapshot, [own], foe)).toEqual({ type: "attack", unitIds: [own.id], targetId: foe.id, queued: false });
    expect(rightClick(snapshot, [own], own)).toBeUndefined();
  });

  it("takes what the pointer is on, the nearest: an ally or an enemy at a mine's foot, the mine on the mine", () => {
    const { game } = alliedGame();
    const mine = game.resources[0]!;
    const worker = game.spawnUnit("player", "worker", mine.x + 150, mine.y);
    const soldier = game.spawnUnit("player", "footman", mine.x + 150, mine.y + 60);
    // Both within the mine's reach (84 from its middle), the ally on one side and the enemy on the other.
    const ally = game.spawnUnit("enemy", "footman", mine.x + 60, mine.y);
    const foe = game.spawnUnit("enemy2", "footman", mine.x - 60, mine.y);
    const snapshot = snapshotGame(game);
    expect(rightClick(snapshot, [worker], ally)).toEqual({ type: "follow", unitIds: [worker.id], targetId: ally.id, queued: false });
    expect(rightClick(snapshot, [worker], foe)).toEqual({ type: "attack", unitIds: [worker.id], targetId: foe.id, queued: false });
    expect(rightClick(snapshot, [worker, soldier], mine)).toEqual({ type: "mine", unitIds: [worker.id], resourceId: mine.id, queued: false });
    // A soldier has nothing to do at a mine: a move there.
    expect(rightClick(snapshot, [soldier], mine)).toBeUndefined();
  });

  it("walks to an ally's building, and attacks an enemy's, the creeps and rocks", () => {
    const { game, own } = alliedGame();
    const snapshot = snapshotGame(game);
    const hall = (owner: string) => snapshot.buildings.find((building) => building.owner === owner && building.kind === "townHall")!;
    expect(rightClick(snapshot, [own], hall("enemy"))).toBeUndefined();
    expect(rightClick(snapshot, [own], hall("enemy2"))).toMatchObject({ type: "attack", targetId: hall("enemy2").id });
    const creep = snapshot.units.find((unit) => unit.owner === "neutral")!;
    expect(rightClick(snapshot, [own], creep)).toMatchObject({ type: "attack", targetId: creep.id });
    const rocks = { id: "rocks-1", kind: "rocks" as const, owner: "neutral" as const, x: 300, y: 300, radius: 40, hp: 500, maxHp: 500, along: { x: 1, y: 0 } };
    expect(rightClick({ ...snapshot, obstacles: [rocks] }, [own], { x: 330, y: 300 })).toMatchObject({ type: "attack", targetId: rocks.id });
  });

  it("tells own, allied, enemy and creep owners apart", () => {
    const snapshot = snapshotGame(alliedGame().game);
    expect(["player", "enemy", "enemy2", "neutral"].map((owner) => relationTo(snapshot, "player", owner as never))).toEqual(["own", "ally", "enemy", "creep"]);
    // Without teams (a duel, an old save), every other player is an enemy.
    expect(relationTo({}, "player", "enemy")).toBe("enemy");
  });

  it("knows a player with an ally, for whom the minimap starts in friend-or-foe colours", () => {
    const snapshot = snapshotGame(alliedGame().game);
    expect(hasAlly(snapshot, "player")).toBe(true);
    expect(hasAlly(snapshot, "enemy2")).toBe(false);
    expect(hasAlly(snapshotGame(createGame("bareDuel", { aiPlayers: [] })), "player")).toBe(false);
  });
});
