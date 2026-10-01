import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "./catalog";
import { BOOTS_SPEED, HEALING_SCROLL_HEAL, MAX_CARRIED_ITEMS, SHOP_GOODS, createShop } from "./shop";
import { createGame, issuePlayerCommand, snapshotGame, stepGame, type Game } from "./sim";
import { commandValidationError } from "./sim/command-validation";
import type { ScenarioUnitSeed, WorldItem } from "./types";

function shopGame(units: ScenarioUnitSeed[], items: WorldItem[] = []): Game {
  return createGame("bareDuel", {
    players: ["player", "enemy"],
    scenario: {
      players: { player: { gold: 1_000 } },
      replaceDefaultUnits: true,
      addShops: [createShop("shop", 600, 600)],
      addUnits: units,
      addItems: items,
    },
  });
}

const unit = (game: Game, id: string) => game.units.find((candidate) => candidate.id === id)!;
const carried = (game: Game, id: string) => game.items.filter((item) => item.carrierId === id).map((item) => item.kind);
const cost = (kind: string) => SHOP_GOODS.find((good) => good.kind === kind)!.cost;
const step = (game: Game, ticks: number) => {
  for (let tick = 0; tick < ticks; tick += 1) stepGame(game);
};

describe("a shop", () => {
  it("sells to a unit standing by it, a worker too, with its owner's gold, and restocks", () => {
    const game = shopGame([{ id: "worker", owner: "player", kind: "worker", x: 600, y: 700 }]);
    issuePlayerCommand(game, "player", { type: "buy", shopId: "shop", item: "speedBoots" });
    expect(game.players.player!.gold).toBe(1_000 - cost("speedBoots"));
    expect(carried(game, "worker")).toEqual(["speedBoots"]);
    expect(unit(game, "worker").speed).toBeCloseTo(Math.round(UNIT_DEFS.worker.speed * BOOTS_SPEED * 100) / 100, 5);
    const boots = game.shops![0]!.goods.find((good) => good.kind === "speedBoots")!;
    expect(boots.stock).toBe(0);
    expect(commandValidationError(snapshotGame(game), "player", { type: "buy", shopId: "shop", item: "speedBoots" })).toMatch(/out of/);
    step(game, boots.restock);
    expect(boots.stock).toBe(1);
  });

  it("sells to nobody without a unit of theirs beside it", () => {
    const game = shopGame([{ id: "far", owner: "player", kind: "footman", x: 1_200, y: 600 }]);
    expect(commandValidationError(snapshotGame(game), "player", { type: "buy", shopId: "shop", item: "regenRing" })).toMatch(/beside it/);
    expect(() => issuePlayerCommand(game, "player", { type: "buy", shopId: "shop", item: "regenRing" })).toThrow(/beside it/);
  });

  it("hands a good to the nearest unit with room, and leaves it at the door when none has", () => {
    const books = (carrierId: string) => Array.from({ length: MAX_CARRIED_ITEMS }, (_, index): WorldItem => ({ id: `${carrierId}-book-${index}`, kind: "experienceBook", x: 600, y: 680, carrierId, cooldownRemaining: 0 }));
    const game = shopGame(
      [
        { id: "near", owner: "player", kind: "footman", x: 600, y: 680 },
        { id: "farther", owner: "player", kind: "footman", x: 600, y: 740 },
      ],
      books("near"),
    );
    issuePlayerCommand(game, "player", { type: "buy", shopId: "shop", item: "regenRing" });
    expect(carried(game, "farther")).toEqual(["regenRing"]);
    game.items.push(...books("farther").slice(1));
    issuePlayerCommand(game, "player", { type: "buy", shopId: "shop", item: "healingScroll" });
    const scroll = game.items.find((item) => item.kind === "healingScroll")!;
    expect(scroll.carrierId).toBeUndefined();
    expect(commandValidationError(snapshotGame(game), "player", { type: "pickupItem", unitId: "near", itemId: scroll.id })).toMatch(/items already/);
  });

  it("is in no game whose map has none", () => {
    expect(snapshotGame(createGame("bareDuel", { players: ["player", "enemy"] })).shops).toBeUndefined();
  });
});

describe("the shop's goods", () => {
  it("a ring heals its carrier two a second, and a second ring no more", () => {
    const game = shopGame([{ id: "footman", owner: "player", kind: "footman", x: 600, y: 700, hp: 50 }]);
    game.items.push(
      { id: "ring-1", kind: "regenRing", x: 600, y: 700, carrierId: "footman", cooldownRemaining: 0 },
      { id: "ring-2", kind: "regenRing", x: 600, y: 700, carrierId: "footman", cooldownRemaining: 0 },
    );
    step(game, 100);
    expect(unit(game, "footman").hp).toBeCloseTo(60, 5);
  });

  it("boots come off with their pace", () => {
    const game = shopGame([{ id: "footman", owner: "player", kind: "footman", x: 600, y: 700 }]);
    issuePlayerCommand(game, "player", { type: "buy", shopId: "shop", item: "speedBoots" });
    const boots = game.items.find((item) => item.kind === "speedBoots")!;
    issuePlayerCommand(game, "player", { type: "dropItem", unitId: "footman", itemId: boots.id, x: 640, y: 700 });
    expect(unit(game, "footman").speed).toBe(UNIT_DEFS.footman.speed);
  });

  it("a healing scroll heals every friend near its reader, and no enemy", () => {
    const game = shopGame([
      { id: "reader", owner: "player", kind: "footman", x: 600, y: 700, hp: 100 },
      { id: "friend", owner: "player", kind: "footman", x: 700, y: 700, hp: 20 },
      { id: "foe", owner: "enemy", kind: "footman", x: 620, y: 760, hp: 40 },
    ]);
    issuePlayerCommand(game, "player", { type: "buy", shopId: "shop", item: "healingScroll" });
    const scroll = game.items.find((item) => item.kind === "healingScroll")!;
    issuePlayerCommand(game, "player", { type: "useItem", unitId: "reader", itemId: scroll.id });
    expect(unit(game, "friend").hp).toBe(20 + HEALING_SCROLL_HEAL);
    expect(unit(game, "reader").hp).toBe(Math.min(unit(game, "reader").maxHp, 100 + HEALING_SCROLL_HEAL));
    expect(unit(game, "foe").hp).toBe(40);
    expect(game.items.some((item) => item.id === scroll.id)).toBe(false);
  });

  it("an ivory tower raises a finished defense tower at half health near its carrier, and nowhere farther", () => {
    const game = shopGame([{ id: "worker", owner: "player", kind: "worker", x: 600, y: 700 }]);
    issuePlayerCommand(game, "player", { type: "buy", shopId: "shop", item: "ivoryTower" });
    const ivory = game.items.find((item) => item.kind === "ivoryTower")!;
    issuePlayerCommand(game, "player", { type: "useItem", unitId: "worker", itemId: ivory.id, x: 900, y: 700 });
    expect(game.buildings.filter((building) => building.kind === "defenseTower")).toHaveLength(0);
    issuePlayerCommand(game, "player", { type: "useItem", unitId: "worker", itemId: ivory.id, x: 720, y: 760 });
    const tower = game.buildings.find((building) => building.kind === "defenseTower")!;
    expect(tower).toMatchObject({ owner: "player", complete: true, x: 720, y: 760 });
    expect(tower.hp).toBe(tower.maxHp / 2);
    expect(game.items.some((item) => item.id === ivory.id)).toBe(false);
  });
});
