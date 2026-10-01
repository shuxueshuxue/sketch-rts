import { describe, expect, it } from "vitest";
import { buildingPlacementBlocker } from "./build-placement";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame, type Game } from "./sim";
import { checkCommandLegality } from "./sim/command-validation";
import type { Obstacle } from "./types";

const DUEL = { d1: "d1", d2: "d2" };

// The pool's bridged river (greystonePass): rocks on the ford straight across its middle (see @@@generated-obstacles),
// with nobody but the two starts' halls and workers on it.
function fordGame(): { game: Game; rocks: Obstacle } {
  const game = createGame("ladder", { players: ["d1", "d2"], aiPlayers: [], teams: DUEL, layout: { seed: "pool-greystonePass-1", kind: "ring", idea: "bridgeStand" } });
  game.units = game.units.filter((unit) => unit.owner !== "neutral");
  const rocks = game.obstacles?.[0];
  if (!rocks) throw new Error("no rocks on the ford");
  return { game, rocks };
}

// A point `reach` from the rocks along the ford, to one side of them (+1) or the other (-1).
function besideRocks(rocks: Obstacle, side: number, reach = rocks.radius + 80) {
  return { x: rocks.x + rocks.along.x * reach * side, y: rocks.y + rocks.along.y * reach * side };
}

function ticksToCross(game: Game, rocks: Obstacle) {
  const from = besideRocks(rocks, 1);
  const to = besideRocks(rocks, -1);
  const walker = game.spawnUnit("d1", "footman", from.x, from.y);
  issuePlayerCommand(game, "d1", { type: "move", unitIds: [walker.id], x: to.x, y: to.y });
  for (let tick = 1; tick <= 8_000; tick += 1) {
    stepGame(game);
    if (walker.order.type === "idle") return tick;
  }
  return Infinity;
}

describe("rocks and gates", () => {
  it("shut their way: a footman crossing the ford walks round by a bridge while the rocks stand, straight over once they are gone", () => {
    const shut = fordGame();
    const open = fordGame();
    delete open.game.obstacles;
    const round = ticksToCross(shut.game, shut.rocks);
    const straight = ticksToCross(open.game, open.rocks);
    expect(straight).toBeLessThan(200);
    expect(round).toBeLessThan(Infinity);
    expect(round).toBeGreaterThan(straight * 3);
  });

  it("are broken by an attack order and gone, which pays nothing and counts as no kill", () => {
    const { game, rocks } = fordGame();
    const gold = game.players.d1!.gold;
    const footmen = [-1, 0, 1].map((step) => {
      const at = besideRocks(rocks, 1);
      return game.spawnUnit("d1", "footman", at.x - rocks.along.y * step * 40, at.y + rocks.along.x * step * 40);
    });
    expect(checkCommandLegality(snapshotGame(game), "d1", { type: "attack", unitIds: footmen.map((unit) => unit.id), targetId: rocks.id })).toBeUndefined();
    issuePlayerCommand(game, "d1", { type: "attack", unitIds: footmen.map((unit) => unit.id), targetId: rocks.id });
    for (let tick = 0; tick < 3_000 && game.obstacles!.length > 0; tick += 1) stepGame(game);
    for (let tick = 0; tick < 5; tick += 1) stepGame(game);
    expect(game.obstacles).toEqual([]);
    expect(footmen.every((unit) => unit.order.type === "idle")).toBe(true);
    expect(game.players.d1!.gold).toBe(gold);
    expect(game.match.stats.unitsKilled.d1 ?? 0).toBe(0);
    expect(game.match.stats.buildingsDestroyed.d1 ?? 0).toBe(0);
  });

  it("are struck by nobody unbidden: a soldier idle beside them, or walking an attack-move past them, leaves them be", () => {
    const { game, rocks } = fordGame();
    const at = besideRocks(rocks, 1);
    const guard = game.spawnUnit("d1", "footman", at.x, at.y);
    const walker = game.spawnUnit("d1", "footman", at.x, at.y);
    const away = besideRocks(rocks, 1, 600);
    issuePlayerCommand(game, "d1", { type: "attackMove", unitIds: [walker.id], x: away.x, y: away.y });
    for (let tick = 0; tick < 400; tick += 1) stepGame(game);
    expect(rocks.hp).toBe(rocks.maxHp);
    expect(guard.order.type).toBe("idle");
  });

  it("keep buildings off them, and are carried whole through a snapshot and a restore", () => {
    const { game, rocks } = fordGame();
    expect(buildingPlacementBlocker(game, "farm", { x: rocks.x + rocks.radius, y: rocks.y })).toBe(rocks);
    rocks.hp -= 100;
    const snapshot = snapshotGame(game);
    expect(snapshot.obstacles).toEqual(game.obstacles);
    expect(snapshot.obstacles![0]).not.toBe(rocks);
    const restored = fordGame().game;
    restoreSnapshotIntoGame(restored, snapshot, game.nextId);
    expect(restored.obstacles).toEqual([{ ...rocks }]);
    const plain = createGame("ladder", { players: ["d1", "d2"], aiPlayers: [], teams: DUEL, layout: { seed: "plain", kind: "ring", idea: "openRing" } });
    expect("obstacles" in snapshotGame(plain)).toBe(false);
  });
});
