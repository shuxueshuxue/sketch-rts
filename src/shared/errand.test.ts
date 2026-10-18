import { describe, expect, it } from "vitest";
import { createGame, issueCommand, stepGame, type Game } from "./sim";
import type { Terrain } from "./terrain";
import type { GameCommand } from "./types";

// See @@@errand. Columns 10 to 29 of the field are deep water; every target here stands on the far bank, so the worker
// walks to the near shore and the order must end there, saying why, instead of walking at the water for good.
function field() {
  const terrain: Terrain = { cell: 32, cols: 40, rows: 40, cells: Array.from({ length: 1600 }, (_, at) => (at % 40 >= 10 && at % 40 < 30 ? "~" : ".")).join("") };
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  game.items = [];
  const mine = game.resources[0]!;
  game.resources = [{ ...mine, id: "far-mine", x: 1100, y: 400 }];
  game.buildings = game.buildings.filter((building) => building.kind === "townHall").map((building, index) => ({ ...building, x: index === 0 ? 120 : 1160, y: index === 0 ? 120 : 1160 }));
  game.map = { ...game.map, terrain, width: 1280, height: 1280 };
  game.scriptedVictory = true;
  return game;
}

function runErrand(game: Game, command: GameCommand, unitId: string) {
  issueCommand(game, command);
  const unit = game.units.find((candidate) => candidate.id === unitId)!;
  const type = unit.order.type;
  for (let tick = 0; tick < 800 && unit.order.type === type; tick++) stepGame(game);
  return { unit, ended: game.effects.filter((effect) => effect.type === "orderEnded" && effect.unitId === unitId) };
}

describe("an errand to a target it cannot reach", () => {
  it("ends a pickup at the shore as unreachable", () => {
    const game = field();
    const worker = game.spawnUnit("player", "footman", 160, 640);
    game.items.push({ id: "far-scroll", kind: "healingScroll", x: 1100, y: 640, cooldownRemaining: 0 });
    const { unit, ended } = runErrand(game, { type: "pickupItem", unitId: worker.id, itemId: "far-scroll" }, worker.id);
    expect(unit.order.type).toBe("idle");
    expect(ended).toMatchObject([{ orderType: "pickupItem", reason: "unreachable", owner: "player" }]);
    expect(unit.x).toBeLessThan(10 * 32);
  });

  it("ends a building repair at the shore as unreachable", () => {
    const game = field();
    const worker = game.spawnUnit("player", "worker", 160, 640);
    const hall = game.buildings.find((building) => building.owner === "player")!;
    game.buildings.push({ ...hall, id: "far-hall", x: 1100, y: 640, hp: hall.maxHp / 2 });
    const { unit, ended } = runErrand(game, { type: "repair", unitIds: [worker.id], buildingId: "far-hall" }, worker.id);
    expect(unit.order.type).toBe("idle");
    expect(ended).toMatchObject([{ orderType: "repair", reason: "unreachable" }]);
  });

  it("ends a machine repair at the shore as unreachable", () => {
    const game = field();
    const worker = game.spawnUnit("player", "worker", 160, 640);
    const golem = game.spawnUnit("player", "golem", 1100, 640);
    golem.hp = golem.maxHp / 2;
    const { unit, ended } = runErrand(game, { type: "repairUnit", unitIds: [worker.id], targetId: golem.id }, worker.id);
    expect(unit.order.type).toBe("idle");
    expect(ended).toMatchObject([{ orderType: "repairUnit", reason: "unreachable" }]);
  });

  it("keeps a mine order across the water: it is what a ferry carries the worker to", () => {
    const game = field();
    const worker = game.spawnUnit("player", "worker", 160, 640);
    const { unit, ended } = runErrand(game, { type: "mine", unitIds: [worker.id], resourceId: "far-mine" }, worker.id);
    expect(unit.order).toMatchObject({ type: "mine", resourceId: "far-mine" });
    expect(ended).toEqual([]);
  });

  it("still finishes an errand it can reach, with no orderEnded", () => {
    const game = field();
    const worker = game.spawnUnit("player", "footman", 160, 640);
    game.items.push({ id: "near-scroll", kind: "healingScroll", x: 260, y: 640, cooldownRemaining: 0 });
    const { unit, ended } = runErrand(game, { type: "pickupItem", unitId: worker.id, itemId: "near-scroll" }, worker.id);
    expect(game.items.find((item) => item.id === "near-scroll")?.carrierId).toBe(unit.id);
    expect(ended).toEqual([]);
  });
});
