import { describe, expect, it } from "vitest";
import { createGame } from "./sim";
import { boardUnit } from "./decks";
import { walkConnectedSurfaces } from "./connected-decks";
import { setBuildingBodies } from "./terrain";
import { hullFits } from "./ship-navigation";
import { syncDecks } from "./decks";
function crossing() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = [];
  game.buildings = [];
  const cols = 40, rows = 80;
  game.map = { ...game.map, width: cols * 32, height: rows * 32, terrain: { cols, rows, cell: 32, cells: Array.from({ length: cols * rows }, (_, i) => i % cols < 10 ? "." : i % cols === 10 ? "," : "~").join("") } };
  const ship = game.spawnUnit("player", "transport", 380, 320);
  ship.sailing!.heading = Math.PI / 2;
  const worker = game.spawnUnit("player", "worker", 0, 0);
  expect(boardUnit(ship, worker, game.units)).toBe(true);
  syncDecks(game.units);
  expect(hullFits(game.map, ship)).toBe(true);
  return { game, ship, worker };
}
describe("connected deck geometry caches", () => {
  it("invalidates shore links when a building blocks or reopens the supporting ground", () => {
    const { game, worker } = crossing();
    const initial = { x: worker.x, y: worker.y, deck: { ...worker.deck! } };
    for (let i = 0; i < 20; i++)
      walkConnectedSurfaces(worker, { x: 100, y: 320 }, game.units, game.map);
    expect(worker.x).not.toBe(initial.x);
    Object.assign(worker, initial, { deck: { ...initial.deck } });
    setBuildingBodies(game.map, [{ x: 320, y: 320, radius: 320 }]);
    for (let i = 0; i < 20; i++)
      walkConnectedSurfaces(worker, { x: 100, y: 320 }, game.units, game.map);
    expect(worker.x).toBe(initial.x);
    expect(worker.y).toBe(initial.y);
    setBuildingBodies(game.map, []);
    for (let i = 0; i < 20; i++)
      walkConnectedSurfaces(worker, { x: 100, y: 320 }, game.units, game.map);
    expect(worker.x).not.toBe(initial.x);
  });
  it("keeps an unrelated shore army out of the crossing's geometry and route", () => {
    const a = crossing(), b = crossing();
    for (let i = 0; i < 300; i++)
      b.game.spawnUnit("enemy", "footman", 32 + (i % 8) * 32, 32 + Math.floor(i / 8) * 32);
    // Place the unrelated force away from the crossing corridor.
    for (const unit of b.game.units.filter(unit => unit.owner === 'enemy')) {
      unit.y = 1000 + unit.y;
    }
    for (let i = 0; i < 60; i++) {
      walkConnectedSurfaces(a.worker, { x: 100, y: 320 }, a.game.units, a.game.map);
      walkConnectedSurfaces(b.worker, { x: 100, y: 320 }, b.game.units, b.game.map);
      expect({ x: b.worker.x, y: b.worker.y, deck: b.worker.deck }).toEqual({ x: a.worker.x, y: a.worker.y, deck: a.worker.deck });
    }
  });
});
