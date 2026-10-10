import { describe, expect, it } from "vitest";
import { createGame, removeUnit, restoreSnapshotIntoGame, snapshotGame, stepGame } from "../sim";
import { isOpenGround } from "../terrain";
import { boardUnit, deckPlacement } from "../decks";
import { cabinDoor, enterCabinStep, isInCabin, leaveCabin } from "../ship-cabin";
import { localToWorld } from "../ship-geometry";
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

  it("reads current positions and radii when the same bodies stay in their previous cells", () => {
    const game = scene();
    const first = fighter(game, 820, 800), second = fighter(game, 850, 800);
    stepGame(game);
    expect([first.x, second.x]).toEqual([817, 853]);
    // Both memberships remain in cell (10, 10), but contact geometry changes.
    first.x = 830; first.radius = 12; first.hp = 17.25;
    second.x = 850; second.radius = 28;
    stepGame(game);
    expect([first.x, second.x]).toEqual([820, 860]);
    expect(first.radius).toBe(12); expect(second.radius).toBe(28);
    expect(first.hp).toBe(17.25);
    first.x = 832; second.x = 852;
    stepGame(game);
    expect([first.x, second.x]).toEqual([822, 862]);
  });

  it("rechecks mining eligibility when a worker's active order changes in place", () => {
    const game = scene();
    const worker = game.spawnUnit("player", "worker", 850, 800);
    worker.effects = [{ type: "stun", remaining: 100 }];
    const other = fighter(game, 850, 800);
    stepGame(game);
    const separated = [worker.x, other.x];
    expect(other.x - worker.x).toBe(worker.radius + other.radius);
    worker.x = other.x = 850;
    worker.order = { type: "mine", resourceId: "not-yet-reached", phase: "toMine", timer: 0 };
    stepGame(game);
    expect(worker.order.type).toBe("mine");
    expect([worker.x, other.x]).toEqual([850, 850]);
    worker.order = { type: "idle" };
    stepGame(game);
    expect([worker.x, other.x]).toEqual(separated);
  });

  it("matches a fresh frame after same-ID replacement, reorder, cell crossing, deaths and expiry", () => {
    const cached = scene(), fresh = scene();
    for (const game of [cached, fresh]) {
      fighter(game, 79, 800); fighter(game, 79, 800); fighter(game, 113, 800);
    }
    const ids = cached.units.map(unit => unit.id);
    const advance = (mutate?: (game: ReturnType<typeof scene>) => void) => {
      for (const game of [cached, fresh]) mutate?.(game);
      // Public restoration removes all transient membership. The reference
      // therefore rebuilds the original pair traversal for every comparison.
      restoreSnapshotIntoGame(fresh, snapshotGame(fresh), fresh.nextId);
      stepGame(cached); stepGame(fresh);
      expect(snapshotGame(cached)).toEqual(snapshotGame(fresh));
    };
    advance();
    advance(); // The first collision crossed a cell boundary itself.
    advance(game => { game.units[1] = { ...game.units[1]!, x: 81 }; });
    advance(game => { game.units.reverse(); for (const unit of game.units) unit.x = 81; });
    advance(game => { game.units.find(unit => unit.id === ids[0])!.x = 160; });
    advance(game => { game.units.find(unit => unit.id === ids[1])!.hp = 0; });
    expect(cached.units.some(unit => unit.id === ids[1])).toBe(false);
    advance(game => { fighter(game, 160, 800).expiresTick = game.tick + 1; });
    expect(cached.units).toHaveLength(2);
    advance(game => { fighter(game, 160, 800); });
    advance(game => { restoreSnapshotIntoGame(game, snapshotGame(game), game.nextId); });
  });

  it("rechecks cabin membership and keeps hulls out of land contact after shelter and exit", () => {
    const cached = scene(), fresh = scene();
    const ship = cached.spawnUnit("player", "transport", 1500, 1500);
    ship.order = { type: "hold", x: ship.x, y: ship.y };
    const passenger = cached.spawnUnit("player", "footman", ship.x, ship.y);
    expect(boardUnit(ship, passenger, cached.units)).toBe(true);
    passenger.order = { type: "hold", x: passenger.x, y: passenger.y };
    const point = deckPlacement(ship, passenger, cached.units, cabinDoor(ship), true, 2)!;
    expect(point).toBeDefined();
    passenger.deck = { shipId: ship.id, ...point };
    Object.assign(passenger, localToWorld(ship, point));
    restoreSnapshotIntoGame(fresh, snapshotGame(cached), cached.nextId);
    const advance = () => {
      restoreSnapshotIntoGame(fresh, snapshotGame(fresh), fresh.nextId);
      stepGame(cached); stepGame(fresh);
      expect(snapshotGame(cached)).toEqual(snapshotGame(fresh));
      expect([ship.x, ship.y]).toEqual([1500, 1500]);
    };
    advance(); advance();
    for (const game of [cached, fresh]) {
      const crew = game.units.find(unit => unit.id === passenger.id)!;
      crew.order = { type: "enterCabin", shipId: ship.id };
      enterCabinStep(game, crew);
      expect(isInCabin(crew)).toBe(true);
    }
    advance(); advance();
    for (const game of [cached, fresh]) {
      const crew = game.units.find(unit => unit.id === passenger.id)!;
      expect(leaveCabin(game, crew)).toBe(true);
      expect(isInCabin(crew)).toBe(false);
    }
    advance(); advance();
    expect(passenger.deck?.shipId).toBe(ship.id);
  });
});
