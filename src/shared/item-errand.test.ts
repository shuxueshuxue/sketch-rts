import { describe, expect, it } from "vitest";
import { createGame, issueCommand, stepGame, type Game } from "./sim";
import { LIGHTNING_ROD } from "./item-rules";
import type { EquipmentSlot, ItemKind, Unit, WorldItem } from "./types";

function field() {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  game.items = [];
  game.scriptedVictory = true;
  return game;
}

function carry(game: Game, unit: Unit, id: string, kind: ItemKind, slot: EquipmentSlot) {
  const item: WorldItem = { id, kind, x: unit.x, y: unit.y, carrierId: unit.id, slot, cooldownRemaining: 0 };
  game.items.push(item);
  return item;
}

function steps(game: Game, ticks: number) {
  for (let tick = 0; tick < ticks; tick += 1) stepGame(game);
}

// @@@item-errand - Items move as a War3 hero's do: slots trade places, and a give, drop or use out of reach is walked to.
describe("moving carried items", () => {
  it("trades two carried items' slots when one is moved onto the other", () => {
    const game = field();
    const footman = game.spawnUnit("player", "footman", 600, 600);
    const rod = carry(game, footman, "rod", "lightningRod", "carry0");
    const scroll = carry(game, footman, "scroll", "healingScroll", "carry2");
    issueCommand(game, { type: "transferItem", itemId: rod.id, destination: { unitId: footman.id, slot: "carry2" } });
    expect([rod.slot, scroll.slot]).toEqual(["carry2", "carry0"]);
  });

  it("hands an item to a friend, walking over first when it stands too far", () => {
    const game = field();
    const giver = game.spawnUnit("player", "footman", 600, 600);
    const near = game.spawnUnit("player", "footman", 600, 650);
    const far = game.spawnUnit("player", "footman", 1100, 600);
    const scroll = carry(game, giver, "scroll", "healingScroll", "carry0");
    issueCommand(game, { type: "giveItem", unitId: giver.id, itemId: scroll.id, targetId: near.id });
    expect(scroll.carrierId).toBe(near.id);
    const rod = carry(game, giver, "rod", "lightningRod", "carry1");
    issueCommand(game, { type: "giveItem", unitId: giver.id, itemId: rod.id, targetId: far.id });
    expect(rod.carrierId).toBe(giver.id);
    steps(game, 200);
    expect(rod.carrierId).toBe(far.id);
    expect(giver.order.type).toBe("idle");
  });

  it("walks to a far point to set an item down there, instead of it landing across the map", () => {
    const game = field();
    const footman = game.spawnUnit("player", "footman", 600, 600);
    const scroll = carry(game, footman, "scroll", "healingScroll", "carry0");
    issueCommand(game, { type: "dropItem", unitId: footman.id, itemId: scroll.id, x: 1000, y: 600 });
    expect(scroll.carrierId).toBe(footman.id);
    steps(game, 200);
    expect(scroll.carrierId).toBeUndefined();
    expect(Math.hypot(scroll.x - 1000, scroll.y - 600)).toBeLessThan(40);
  });

  it("walks a rod's carrier into reach of a foe it was used on, then strikes", () => {
    const game = field();
    const footman = game.spawnUnit("player", "footman", 600, 600);
    const foe = game.spawnUnit("enemy", "footman", 600 + LIGHTNING_ROD.range + 200, 600);
    foe.attackDamage = 0;
    const rod = carry(game, footman, "rod", "lightningRod", "carry0");
    issueCommand(game, { type: "useItem", unitId: footman.id, itemId: rod.id, targetId: foe.id });
    expect(footman.order).toMatchObject({ type: "itemErrand", action: "use", targetId: foe.id });
    steps(game, 200);
    expect(foe.hp).toBeLessThan(foe.maxHp);
  });
});
