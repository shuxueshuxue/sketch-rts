import { describe, expect, it, vi } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
import { pointerTarget } from "./relations";
import { unitHoverTarget } from "./unit-hover-target";

function fixture() {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = []; game.items = []; game.resources = []; game.obstacles = [];
  const unit = game.spawnUnit("player", "footman", 600, 600);
  const camp = { id: "camp", x: 600, y: 600, radius: 48, hireKind: "mercenary" as const, cost: 100, stock: 5, cooldown: 90, cooldownRemaining: 0 };
  game.mercenaryCamps = [camp];
  const shop = { id: "shop", x: 600, y: 600, radius: 48, goods: [] };
  game.shops = [shop];
  return { game, unit, camp, shop };
}

describe("unit hover body resolution", () => {
  it.each(["camp", "shop"] as const)("keeps a visible %s ahead of a ground unit and makes exactly one visual pick", kind => {
    const { game, unit, camp, shop } = fixture(), snapshot = snapshotGame(game), site = kind === "camp" ? camp : shop;
    const visual = vi.fn(() => ({ id: site.id }));
    const ground = vi.fn(() => pointerTarget(snapshot, unit));
    expect(pointerTarget(snapshot, unit)).toMatchObject({ kind: "unit", unit: { id: unit.id } });
    expect(unitHoverTarget(snapshot, unit, visual, ground)).toMatchObject({ id: site.id, owner: "neutral" });
    expect(visual).toHaveBeenCalledTimes(1); expect(ground).not.toHaveBeenCalled();
  });

  it("keeps an authoritative unit or building ahead of a neutral site", () => {
    const { game, unit } = fixture(), building = game.buildings[0]!, snapshot = snapshotGame(game);
    const ground = vi.fn(() => pointerTarget(snapshot, unit));
    expect(unitHoverTarget(snapshot, unit, () => ({ id: unit.id }), ground)).toBe(snapshot.units[0]);
    expect(unitHoverTarget(snapshot, unit, () => ({ id: building.id }), ground)).toBe(snapshot.buildings[0]);
    expect(ground).not.toHaveBeenCalled();
  });

  it("uses the original ground body priority only when the visual pick misses", () => {
    const { game, unit } = fixture(), snapshot = snapshotGame(game);
    const visual = vi.fn(() => undefined), ground = vi.fn(() => pointerTarget(snapshot, unit));
    expect(unitHoverTarget(snapshot, unit, visual, ground)).toBe(snapshot.units[0]);
    expect(visual).toHaveBeenCalledTimes(1); expect(ground).toHaveBeenCalledTimes(1);
    game.units = [];
    expect(unitHoverTarget(snapshotGame(game), unit, () => undefined)).toMatchObject({ id: "camp", owner: "neutral" });
    game.mercenaryCamps = [];
    expect(unitHoverTarget(snapshotGame(game), unit, () => undefined)).toMatchObject({ id: "shop", owner: "neutral" });
    expect(unitHoverTarget(snapshotGame(game), { x: 1000, y: 1000 }, () => undefined)).toBeUndefined();
  });

  it("keeps a ground building ahead of an overlapping neutral site", () => {
    const { game, unit } = fixture(), building = game.buildings[0]!;
    game.units = []; building.x = unit.x; building.y = unit.y;
    const snapshot = snapshotGame(game);
    expect(unitHoverTarget(snapshot, unit, () => undefined)).toBe(snapshot.buildings[0]);
  });

  it("does not fall through a stale, dead or sheltered visual body to an entity behind it", () => {
    const { game, unit } = fixture(), building = game.buildings[0]!;
    const ground = vi.fn(() => ({ kind: "unit" as const, unit }));
    expect(unitHoverTarget(snapshotGame(game), unit, () => ({ id: "stale" }), ground)).toBeUndefined();
    unit.hp = 0;
    expect(unitHoverTarget(snapshotGame(game), unit, () => ({ id: unit.id }), ground)).toBeUndefined();
    unit.hp = unit.maxHp; unit.cabin = { shipId: "ship" }; unit.deck = { shipId: "ship", x: 0, y: 0 };
    expect(unitHoverTarget(snapshotGame(game), unit, () => ({ id: unit.id }), ground)).toBeUndefined();
    building.hp = 0;
    expect(unitHoverTarget(snapshotGame(game), unit, () => ({ id: building.id }), ground)).toBeUndefined();
    expect(ground).not.toHaveBeenCalled();
  });

  it("clears dead and sheltered ground picks as well", () => {
    const { game, unit } = fixture(), building = game.buildings[0]!;
    unit.hp = 0;
    expect(unitHoverTarget(snapshotGame(game), unit, () => undefined, () => ({ kind: "unit", unit }))).toBeUndefined();
    unit.hp = unit.maxHp; unit.cabin = { shipId: "ship" }; unit.deck = { shipId: "ship", x: 0, y: 0 };
    expect(unitHoverTarget(snapshotGame(game), unit, () => undefined, () => ({ kind: "unit", unit }))).toBeUndefined();
    building.hp = 0;
    expect(unitHoverTarget(snapshotGame(game), unit, () => undefined, () => ({ kind: "building", building }))).toBeUndefined();
  });
});
