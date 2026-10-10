import { describe, expect, it } from "vitest";
import { createGame, removeUnit, restoreSnapshotIntoGame, snapshotGame, stepGame } from "../sim";
import { isOpenGround } from "../terrain";
import type { Unit } from "../types";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.scriptedVictory = true;
  delete game.map.terrain;
  return game;
}

function fighter(game: ReturnType<typeof scene>, x: number, y: number): Unit {
  const unit = game.spawnUnit("player", "footman", x, y);
  unit.order = { type: "hold", x, y };
  return unit;
}

describe("unit contact separation in simulation frames", () => {
  it("separates neighboring cells even when the right-hand cell was inserted first", () => {
    const game = scene();
    const right = fighter(game, 85, 160);
    const left = fighter(game, 75, 160);
    stepGame(game);
    expect([left.x, left.y, right.x, right.y]).toEqual([62, 160, 98, 160]);
    expect(right.hp).toBe(right.maxHp);
    expect(left.hp).toBe(left.maxHp);
  });

  it("preserves crowded-body contact order after moving cells, reordering units and restoring the same game", () => {
    const game = scene();
    const units = [fighter(game, 400, 800), fighter(game, 600, 800), fighter(game, 1000, 800)];
    const ids = units.map(unit => unit.id);
    stepGame(game);
    for (const unit of units) unit.x = 800;
    stepGame(game);
    expect(units.map(unit => [unit.x, unit.y])).toEqual([[773, 800], [831.5, 800], [795.5, 800]]);

    restoreSnapshotIntoGame(game, snapshotGame(game), game.nextId);
    game.units.reverse();
    for (const unit of game.units) unit.x = 800;
    stepGame(game);
    expect(ids.map(id => {
      const unit = game.units.find(unit => unit.id === id)!;
      return [unit.x, unit.y];
    })).toEqual([[795.5, 800], [831.5, 800], [773, 800]]);
  });

  it("slides one collision endpoint along a forest wall while preserving the other's unconstrained endpoint", () => {
    const game = scene();
    const rows = Array.from({ length: 20 }, () => ".".repeat(10) + "T" + ".".repeat(9));
    game.map = { ...game.map, width: 640, height: 640, terrain: { cell: 32, cols: 20, rows: 20, cells: rows.join("") } };
    const open = fighter(game, 299, 100);
    const wall = fighter(game, 315, 108);
    stepGame(game);
    expect(open.x).toBeCloseTo(290.9003105620015, 10);
    expect(open.y).toBeCloseTo(95.95015528100076, 10);
    expect(wall.x).toBe(315);
    expect(wall.y).toBeCloseTo(112.04984471899924, 10);
    expect(isOpenGround(game.map, open.x, open.y)).toBe(true);
    expect(isOpenGround(game.map, wall.x, wall.y)).toBe(true);
  });

  it("uses newly spawned bodies after an old collision participant leaves the game", () => {
    const game = scene();
    const standing = fighter(game, 800, 800);
    const departing = fighter(game, 800, 800);
    stepGame(game);
    expect([standing.x, departing.x]).toEqual([782, 818]);
    removeUnit(game, departing.id);
    standing.x = 800;
    stepGame(game);
    expect(standing.x).toBe(800);
    expect(departing.x).toBe(818);
    const arriving = fighter(game, 800, 800);
    stepGame(game);
    expect([standing.x, arriving.x]).toEqual([782, 818]);
    expect(departing.x).toBe(818);
  });
});
