import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
import { relationTo, rightClickOrder } from "./relations";

// The player and "enemy" on one team, "enemy2" on the other.
function alliedGame() {
  const game = createGame("verdantCrossroads", { players: ["player", "enemy", "enemy2"], aiPlayers: [], teams: { player: "north", enemy: "north", enemy2: "south" } });
  const own = game.spawnUnit("player", "footman", 600, 600);
  const ally = game.spawnUnit("enemy", "footman", 800, 600);
  const foe = game.spawnUnit("enemy2", "footman", 1000, 600);
  return { game, own, ally, foe };
}

describe("right-click orders", () => {
  it("follows an ally's unit and attacks an enemy's, as in Warcraft III", () => {
    const { game, own, ally, foe } = alliedGame();
    const snapshot = snapshotGame(game);
    expect(rightClickOrder(snapshot, "player", [own.id], ally, true)?.command).toEqual({ type: "follow", unitIds: [own.id], targetId: ally.id, queued: true });
    expect(rightClickOrder(snapshot, "player", [own.id], foe)?.command).toEqual({ type: "attack", unitIds: [own.id], targetId: foe.id, queued: false });
    // An own unit is neither: the right-click is a move (or a board, a mine or a repair) there.
    expect(rightClickOrder(snapshot, "player", [own.id], own)).toBeUndefined();
  });

  it("walks to an ally's building, and attacks an enemy's, the creeps and rocks", () => {
    const { game, own } = alliedGame();
    const snapshot = snapshotGame(game);
    const hall = (owner: string) => snapshot.buildings.find((building) => building.owner === owner && building.kind === "townHall")!;
    expect(rightClickOrder(snapshot, "player", [own.id], hall("enemy"))).toBeUndefined();
    expect(rightClickOrder(snapshot, "player", [own.id], hall("enemy2"))?.command).toMatchObject({ type: "attack", targetId: hall("enemy2").id });
    const creep = snapshot.units.find((unit) => unit.owner === "neutral")!;
    expect(rightClickOrder(snapshot, "player", [own.id], creep)?.command).toMatchObject({ type: "attack", targetId: creep.id });
    const rocks = { id: "rocks-1", kind: "rocks" as const, owner: "neutral" as const, x: 300, y: 300, radius: 40, hp: 500, maxHp: 500, along: { x: 1, y: 0 } };
    expect(rightClickOrder({ ...snapshot, obstacles: [rocks] }, "player", [own.id], { x: 330, y: 300 })?.command).toMatchObject({ type: "attack", targetId: rocks.id });
  });

  it("tells own, allied, enemy and creep owners apart", () => {
    const snapshot = snapshotGame(alliedGame().game);
    expect(["player", "enemy", "enemy2", "neutral"].map((owner) => relationTo(snapshot, "player", owner as never))).toEqual(["own", "ally", "enemy", "creep"]);
    // Without teams (a duel, an old save), every other player is an enemy.
    expect(relationTo({}, "player", "enemy")).toBe("enemy");
  });
});
