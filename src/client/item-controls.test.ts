import { describe, expect, it } from "vitest";
import { createGame, issueCommand, stepGame } from "../shared/sim";
import { dropItemCommand, itemHotkey, itemHotkeys, pickupItemCommand, useItemCommand } from "./item-controls";
import type { Unit, WorldItem } from "../shared/types";

describe("item controls", () => {
  it("maps item slots to compact labels and number hotkeys", () => {
    expect(itemHotkey(0)).toBe("1");
    expect(itemHotkey(5)).toBe("6");
    expect(itemHotkeys(3, new Set([1, 3]))).toEqual(["2", "4", "5"]);
  });

  it("uses and drops carried items through ordinary player commands", () => {
    const game = createGame();
    const carrier = unit("carrier", 100, 100);
    const enemy = unit("enemy-target", 180, 100, "enemy");
    const rod: WorldItem = { id: "rod", kind: "lightningRod", x: 0, y: 0, carrierId: carrier.id, cooldownRemaining: 0 };
    game.units = [carrier, enemy];
    game.items = [rod];

    expect(useItemCommand(game, "player", rod, carrier)).toEqual({ type: "useItem", unitId: carrier.id, itemId: rod.id, targetId: enemy.id });
    expect(dropItemCommand(rod, carrier)).toEqual({ type: "dropItem", unitId: carrier.id, itemId: rod.id, x: 133, y: 108 });
  });

  it("treats neutral wildlings as valid enemy targets for player damage items", () => {
    const game = createGame();
    const carrier = unit("carrier", 100, 100);
    const wildling = unit("wildling-target", 180, 100, "neutral");
    const rod: WorldItem = { id: "rod", kind: "lightningRod", x: 0, y: 0, carrierId: carrier.id, cooldownRemaining: 0 };
    game.units = [carrier, wildling];
    game.items = [rod];

    expect(useItemCommand(game, "player", rod, carrier)).toEqual({ type: "useItem", unitId: carrier.id, itemId: rod.id, targetId: wildling.id });
  });

  it("picks the nearest selected unit for a ground item", () => {
    const near = unit("near", 100, 100);
    const far = unit("far", 600, 600);
    const item: WorldItem = { id: "book", kind: "experienceBook", x: 140, y: 100, cooldownRemaining: 0 };

    expect(pickupItemCommand([far, near], item)).toEqual({ type: "pickupItem", unitId: near.id, itemId: item.id });
  });

  it("lets a pickup command walk into range before carrying the item", () => {
    const game = createGame();
    const carrier = game.units.find((candidate) => candidate.owner === "player" && candidate.kind === "footman") ?? game.spawnUnit("player", "footman", 800, 800);
    const item: WorldItem = { id: "far-book", kind: "experienceBook", x: carrier.x + 180, y: carrier.y, cooldownRemaining: 0 };
    game.items.push(item);

    issueCommand(game, { type: "pickupItem", unitId: carrier.id, itemId: item.id });
    for (let i = 0; i < 80 && !item.carrierId; i += 1) stepGame(game);

    expect(item.carrierId).toBe(carrier.id);
  });
});

function unit(id: string, x: number, y: number, owner: Unit["owner"] = "player"): Unit {
  return {
    id,
    owner,
    kind: "footman",
    x,
    y,
    hp: 100,
    maxHp: 100,
    speed: 3,
    attackDamage: 10,
    attackRange: 50,
    attackCooldown: 10,
    cooldown: 0,
    radius: 15,
    carryingGold: 0,
    kills: 0,
    xp: 0,
    level: 0,
    effects: [],
    order: { type: "idle" },
  };
}
