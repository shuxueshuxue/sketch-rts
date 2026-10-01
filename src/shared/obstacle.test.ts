import { describe, expect, it } from "vitest";
import { buildingPlacementBlocker } from "./build-placement";
import { MAP_POOL, type PoolMap } from "./map-pool";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame, type Game } from "./sim";
import { checkCommandLegality } from "./sim/command-validation";
import type { Obstacle, PlayerId } from "./types";

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

// A point `reach` from an obstacle along the way it shuts, to one side of it (+1) or the other (-1).
function beside(obstacle: Obstacle, side: number, reach = obstacle.radius + 80) {
  return { x: obstacle.x + obstacle.along.x * reach * side, y: obstacle.y + obstacle.along.y * reach * side };
}

// A pool map's game with nobody on it but the starts' halls and workers, seated as duel2 seats it.
function poolGame(entry: PoolMap): Game {
  const players = Array.from({ length: entry.players }, (_, index) => `s${index + 1}`);
  const teams = Object.fromEntries(players.map((player, index) => [player, entry.layout.kind === "sides" ? (index < players.length / 2 ? "north" : "south") : player]));
  const game = createGame("ladder", { players, aiPlayers: [], teams, layout: entry.layout });
  game.units = game.units.filter((unit) => unit.owner !== "neutral");
  return game;
}

// The ticks a footman of `owner` takes from one side of the obstacle to the other, along the way it shuts.
function ticksToCross(game: Game, obstacle: Obstacle, owner: PlayerId) {
  const from = beside(obstacle, 1);
  const to = beside(obstacle, -1);
  const walker = game.spawnUnit(owner, "footman", from.x, from.y);
  issuePlayerCommand(game, owner, { type: "move", unitIds: [walker.id], x: to.x, y: to.y });
  for (let tick = 1; tick <= 12_000; tick += 1) {
    stepGame(game);
    if (walker.order.type === "idle") return tick;
  }
  return Infinity;
}

describe("rocks and gates", () => {
  // As the sim's routing shuts cells round a body (see @@@building-pathing), not as the generator's grid reckons it.
  it("shut their way on every pool map: a footman walks round each one while it stands, and straight past once it is gone", () => {
    let seen = 0;
    for (const entry of MAP_POOL) {
      const obstacles = poolGame(entry).obstacles ?? [];
      obstacles.forEach((obstacle, index) => {
        const open = poolGame(entry);
        open.obstacles = open.obstacles!.filter((_, other) => other !== index);
        const round = ticksToCross(poolGame(entry), obstacle, "s1");
        const straight = ticksToCross(open, obstacle, "s1");
        expect(straight, `${entry.id} ${obstacle.kind} ${index}`).toBeLessThan(200);
        expect(round, `${entry.id} ${obstacle.kind} ${index}`).toBeGreaterThan(straight * 3);
        seen += 1;
      });
    }
    expect(seen).toBe(5);
  });

  it("are broken by an attack order and gone, which pays nothing and counts as no kill", () => {
    const { game, rocks } = fordGame();
    const gold = game.players.d1!.gold;
    const footmen = [-1, 0, 1].map((step) => {
      const at = beside(rocks, 1);
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
    const at = beside(rocks, 1);
    const guard = game.spawnUnit("d1", "footman", at.x, at.y);
    const walker = game.spawnUnit("d1", "footman", at.x, at.y);
    const away = beside(rocks, 1, 600);
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
