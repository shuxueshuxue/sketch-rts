import { expect, it } from "vitest";
import { UNIT_DEFS, UNIT_RULES, resolveVariant, type VariantRules } from "./catalog";
import { createBuilding } from "./map";
import { createGame, restoreSnapshotIntoGame, snapshotGame, spawnVariantUnit, stepGame, tryPlayerCommand } from "./sim";
import { canStandOnTower, garrisonRoomFor } from "./tower-garrison";
import { unitBodyFormOf, type UnitBodyForm } from "./unit-body-form";
import type { UnitKind } from "./types";

const FORMS: Record<UnitBodyForm, UnitKind[]> = {
  foot: ["worker", "footman", "archer", "lancer", "ashWarden", "emberRavager", "cinderRunner", "sparkArcher", "ashHexer", "priest", "summoner", "witch", "ashChieftain", "cinderRevenant", "mercenary", "contractArcher", "fieldMedic", "wildling", "thornSlinger", "barkMender", "gladeWitch", "murlocPeon", "murlocHunter", "tidePriest", "ogreWarrior", "ogreMage", "ogreLord"],
  mounted: ["horseArcher", "raider", "knight"],
  beast: ["mossGnawer", "stonebackBrute", "ancientStag", "deepSnapper", "spiderling", "venomSpider", "spiderQueen", "dragonWhelp", "redDragon"],
  machine: ["golem", "transport", "warship", "shipOfTheLine", "cutter", "bombardShip", "fireShip", "carrier", "siegeRam", "ballista", "catapult", "organGun", "rubbleGolem", "rockGolem", "graniteGolem"],
  spirit: ["spirit"],
};

function field() {
  const game = createGame("bareDuel", { aiPlayers: [] }); game.units = []; game.buildings = []; game.scriptedVictory = true;
  const tower = createBuilding("tower", "player", "fortifiedTower", 1000, 1000, true); game.buildings.push(tower);
  return { game, tower };
}

it("declares a reviewed physical form for every catalog row, with no inferred default", () => {
  expect(Object.values(FORMS).flat().sort()).toEqual(Object.keys(UNIT_RULES).sort());
  for (const [form, kinds] of Object.entries(FORMS)) for (const kind of kinds) {
    expect(Object.hasOwn(UNIT_RULES[kind], "bodyForm"), kind).toBe(true);
    expect(UNIT_DEFS[kind].bodyForm, kind).toBe(form);
  }
});

it("admits every stock foot kind and refuses every other form using the shared policy", () => {
  for (const [form, kinds] of Object.entries(FORMS)) for (const kind of kinds) {
    const { game, tower } = field(), unit = game.spawnUnit("player", kind, 1000, 1100);
    expect(canStandOnTower(unit, game), kind).toBe(form === "foot");
    expect(garrisonRoomFor(game, tower, unit), kind).toBe(form === "foot");
  }
});

it.each(["knight", "raider", "horseArcher", "ancientStag", "spirit"] as const)("refuses %s with its form and preserves existing orders", kind => {
  const { game, tower } = field(), unit = game.spawnUnit("player", kind, 1000, 1100);
  unit.order = { type: "move", x: 1500, y: 1100 }; unit.orderQueue = [{ type: "hold", x: 1500, y: 1100 }];
  const before = structuredClone([unit.order, unit.orderQueue]), nextId = game.nextId;
  const refusal = { reason: "garrison-not-infantry", detail: { buildingId: tower.id, bodyForm: UNIT_DEFS[kind].bodyForm } };
  expect(tryPlayerCommand(game, "player", { type: "garrison", unitIds: [unit.id], buildingId: tower.id })).toMatchObject({ ok: false, refusal });
  expect([unit.order, unit.orderQueue]).toEqual(before); expect(game.nextId).toBe(nextId);
  expect(game.effects).toContainEqual(expect.objectContaining({ type: "orderEnded", owner: "player", unitId: unit.id, orderType: "garrison", reason: "refused", refusal }));
});

it("reads variant overrides, while older saved variants inherit their base's explicit form", () => {
  const { game, tower } = field(); game.variants = {
    rider: resolveVariant({ base: "footman", bodyForm: "mounted" }),
    dismounted: resolveVariant({ base: "knight", bodyForm: "foot" }),
  };
  const rider = spawnVariantUnit(game, "player", "rider", 1000, 1100), dismounted = spawnVariantUnit(game, "player", "dismounted", 1100, 1100);
  expect(canStandOnTower(rider, game)).toBe(false); expect(garrisonRoomFor(game, tower, dismounted)).toBe(true);
  const { bodyForm: _form, ...older } = resolveVariant({ base: "knight" });
  expect(unitBodyFormOf({ kind: "knight", variant: "old" }, { variants: { old: older as VariantRules } })).toBe("mounted");
  const copy = field().game; restoreSnapshotIntoGame(copy, snapshotGame(game), game.nextId);
  expect(copy.variants!.rider!.bodyForm).toBe("mounted"); expect(canStandOnTower(copy.units[0]!, copy)).toBe(false);
  expect(canStandOnTower(copy.units[1]!, copy)).toBe(true);
});

it("keeps a summoned foot troop eligible and a permanent spirit ineligible", () => {
  const { game, tower } = field();
  const summoned = game.spawnUnit("player", "mercenary", 1000, 1070); summoned.expiresTick = game.tick + 500;
  const spirit = game.spawnUnit("player", "spirit", 1100, 1100);
  expect(spirit.expiresTick).toBeUndefined(); expect(canStandOnTower(spirit, game)).toBe(false);
  expect(tryPlayerCommand(game, "player", { type: "garrison", unitIds: [summoned.id, spirit.id], buildingId: tower.id }).ok).toBe(true);
  for (let i = 0; i < 100; i++) stepGame(game);
  expect(summoned.garrison).toEqual({ buildingId: tower.id }); expect(spirit.garrison).toBeUndefined();
});

it("puts formerly admitted riders, beasts and spirits down when a saved garrison is stepped", () => {
  const { game, tower } = field();
  const units = (["knight", "ancientStag", "spirit"] as const).map(kind => game.spawnUnit("player", kind, tower.x, tower.y));
  units.forEach(unit => unit.garrison = { buildingId: tower.id });
  const copy = field().game; restoreSnapshotIntoGame(copy, snapshotGame(game), game.nextId); stepGame(copy);
  expect(copy.units.every(unit => !unit.garrison)).toBe(true);
});
