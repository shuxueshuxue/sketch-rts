import { RULES_VERSION, assertCurrentRulesVersion, savedRulesVersion } from "./rules-version";
import { describe, expect, it } from "vitest";
import { UNIT_DEFS, resolveVariant } from "./catalog";
import { createBuilding } from "./map";
import { createGame, issuePlayerCommand, refreshUnitStats, restoreSnapshotIntoGame, snapshotGame, spawnVariantUnit, stepGame, strikeUnit, tryPlayerCommand } from "./sim";
import { canStandOnTower, garrisonRoomFor, towerTopLayout } from "./tower-garrison";
import { isRangedUnit } from "./unit-weapon-class";
import { rollVeteranSkillChoices } from "./veteran-skills";
import { veteranWeaponRange } from "./veteran-stats";
import type { Game, } from "./sim";
import type { Unit, UnitKind, WorldItem } from "./types";
import { strikeReach } from "./combat-geometry";

function field() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.scriptedVictory = true;
  const tower = createBuilding("tower", "player", "fortifiedTower", 1000, 1000, true);
  game.buildings.push(tower);
  return { game, tower };
}
function advance(game: Game, ticks = 150) { for (let i = 0; i < ticks; i++) stepGame(game); }
function bow(game: Game, unit: Unit) {
  const item: WorldItem = { id: "bow", kind: "issuedWeapon", weaponKind: "archer", carrierId: unit.id, slot: "carry0", x: unit.x, y: unit.y, cooldownRemaining: 0 };
  game.items.push(item); unit.hands = { right: item.id }; refreshUnitStats(game, unit);
  return item;
}
function resident(game: Game) {
  const up = game.spawnUnit("player", "footman", 1000, 1080);
  issuePlayerCommand(game, "player", { type: "garrison", unitIds: [up.id], buildingId: "tower" });
  advance(game); up.attackDamage = 0; return up;
}

it("versions the changed gameplay rules while keeping older saves readable", () => {
  expect(RULES_VERSION).toBe(8); expect(savedRulesVersion(7)).toBe(7);
  expect(() => assertCurrentRulesVersion(7, "Old replay")).toThrow(/Cross-version simulation/);
});

describe("weapon category before range bonuses", () => {
  it.each(["knight", "raider", "lancer"] as const)("keeps a fully range-trained %s melee, at its original reach, unable to hit the top", kind => {
    const { game } = field(); const up = resident(game);
    game.players.enemy!.upgrades.rangeTraining = 3;
    const down = game.spawnUnit("enemy", kind, 1065, 1000);
    down.veteranSkill = "veteranSiegeDrill"; refreshUnitStats(game, down);
    expect(down.attackRange).toBe(UNIT_DEFS[kind].attackRange);
    expect(isRangedUnit(down)).toBe(false);
    down.attackRange = 999; // A transient live range must never redefine the weapon.
    expect(strikeReach(down, up)).toBe(-Infinity);
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [down.id], targetId: up.id });
    advance(game);
    expect(up.hp).toBe(up.maxHp); expect(down.aim).toBeUndefined();
  });

  it("lets a footman's equipped bow reach the top, receive research, and lose the bonus when put away", () => {
    const { game } = field(); const up = resident(game);
    game.players.enemy!.upgrades.rangeTraining = 3;
    const down = game.spawnUnit("enemy", "footman", 1200, 1000); bow(game, down);
    expect(down.attackRange).toBe(Math.round(UNIT_DEFS.archer.attackRange * 1.35));
    expect(isRangedUnit(down)).toBe(true);
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [down.id], targetId: up.id }); advance(game);
    expect(up.hp).toBeLessThan(up.maxHp);
    down.hands = {}; refreshUnitStats(game, down);
    expect(down.attackRange).toBe(UNIT_DEFS.footman.attackRange);
    expect(strikeReach(down, up)).toBe(-Infinity);
  });

  it("classifies a variant from its own weapon definition and rebuilds the cache on restore", () => {
    const { game } = field(); game.variants = { longbow: resolveVariant({ base: "footman", attackRange: 300 }) };
    const unit = spawnVariantUnit(game, "player", "longbow", 1200, 1000);
    expect(isRangedUnit(unit)).toBe(true);
    const snapshot = snapshotGame(game); delete snapshot.units[0]!.attackClass;
    const copy = field().game; restoreSnapshotIntoGame(copy, snapshot, game.nextId);
    expect(isRangedUnit(copy.units[0]!)).toBe(true);
  });

  it("offers Rangefinding only with a ranged weapon and suspends a learned bonus while wielding melee", () => {
    const { game } = field(); game.variants = { small: resolveVariant({ base: "ballista", radius: 20 }) };
    const unit = spawnVariantUnit(game, "player", "small", 1200, 1000);
    unit.veteranSkill = "veteranSiegeDrill"; refreshUnitStats(game, unit); advance(game, 1);
    expect(unit.attackRange).toBeCloseTo(UNIT_DEFS.ballista.attackRange * 1.1);
    const sword: WorldItem = { id: "sword", kind: "greatSword", carrierId: unit.id, slot: "carry0", x: unit.x, y: unit.y, cooldownRemaining: 0 };
    game.items.push(sword); unit.hands = { right: sword.id }; refreshUnitStats(game, unit); advance(game, 1);
    expect(unit.attackRange).toBe(48);
    expect(veteranWeaponRange(unit, 48)).toBe(48);
    for (let seed = 0; seed < 30; seed++) expect(rollVeteranSkillChoices(unit.kind, unit.id, seed, "mechanical", isRangedUnit(unit))).not.toContain("veteranSiegeDrill");
    unit.hands = {}; refreshUnitStats(game, unit); advance(game, 1);
    expect(unit.attackRange).toBeCloseTo(UNIT_DEFS.ballista.attackRange * 1.1);
    // Exercise the sim's actual offer generation after wielding a melee weapon.
    unit.hands = { right: sword.id }; refreshUnitStats(game, unit);
    delete unit.veteranSkill; unit.xp = 100_000;
    const victim = game.spawnUnit("enemy", "worker", 1300, 1000);
    strikeUnit(game, unit, victim, 1000, "melee");
    expect(unit.level).toBe(3); expect(unit.veteranSkillChoices).not.toContain("veteranSiegeDrill");
  });
});

it("removes an older saved melee research bonus on restore without changing health", () => {
  const { game } = field(); const unit = game.spawnUnit("player", "knight", 1200, 1000);
  game.players.player!.upgrades.rangeTraining = 3;
  const snapshot = snapshotGame(game); delete snapshot.units[0]!.attackClass; snapshot.units[0]!.attackRange = 97; snapshot.units[0]!.hp = 111;
  const copy = field().game; restoreSnapshotIntoGame(copy, snapshot, game.nextId);
  expect(copy.units[0]!.attackRange).toBe(UNIT_DEFS.knight.attackRange); expect(copy.units[0]!.hp).toBe(111);
});

describe("tower admission and whole bodies", () => {
  it("reads mechanical eligibility from the current unit definition, including variants", () => {
    const { game, tower } = field(); game.variants = {
      machine: resolveVariant({ base: "footman", unitClass: "mechanical" }),
      living: resolveVariant({ base: "golem", unitClass: "nonMechanical" }),
    };
    const machine = spawnVariantUnit(game, "player", "machine", 1000, 1100), living = spawnVariantUnit(game, "player", "living", 1100, 1100);
    expect(canStandOnTower(machine, game)).toBe(false); expect(garrisonRoomFor(game, tower, machine)).toBe(false);
    expect(canStandOnTower(living, game)).toBe(true); expect(garrisonRoomFor(game, tower, living)).toBe(true);
  });
  it.each(["ballista", "catapult", "siegeRam", "golem", "organGun"] as const)("explicitly refuses a %s without cancelling its previous orders", kind => {
    const { game, tower } = field(); const unit = game.spawnUnit("player", kind, 1000, 1100);
    unit.order = { type: "move", x: 1500, y: 1100 }; unit.orderQueue = [{ type: "hold", x: 1500, y: 1100 }];
    const before = structuredClone([unit.order, unit.orderQueue]), nextId = game.nextId;
    expect(canStandOnTower(unit, game)).toBe(false);
    expect(garrisonRoomFor(game, tower, unit)).toBe(false);
    expect(tryPlayerCommand(game, "player", { type: "garrison", unitIds: [unit.id], buildingId: tower.id }).ok).toBe(false);
    expect([unit.order, unit.orderQueue]).toEqual(before); expect(game.nextId).toBe(nextId);
    expect(game.effects).toContainEqual(expect.objectContaining({ type: "orderEnded", unitId: unit.id, owner: "player", orderType: "garrison", reason: "refused", refusal: { reason: "garrison-mechanical", detail: { buildingId: tower.id } } }));
  });

  it.each(([["knight", "worker"], ["ancientStag"], ["spirit", "spirit", "spirit", "spirit"], ["footman", "footman"]] as UnitKind[][]).map(kinds => [kinds] as const))("packs %j inside the top without overlapping", kinds => {
    const { game, tower } = field();
    const units = kinds.map((kind, i) => game.spawnUnit("player", kind, 1000 - i * 40, 1100));
    issuePlayerCommand(game, "player", { type: "garrison", unitIds: units.map(unit => unit.id), buildingId: tower.id }); advance(game, 240);
    for (const [i, unit] of units.entries()) {
      expect(unit.garrison).toEqual({ buildingId: tower.id });
      expect(Math.hypot(unit.x - tower.x, unit.y - tower.y) + unit.radius).toBeLessThanOrEqual(tower.radius + 1e-6);
      for (const other of units.slice(0, i)) expect(Math.hypot(unit.x - other.x, unit.y - other.y)).toBeGreaterThanOrEqual(unit.radius + other.radius - 1e-6);
    }
    const layout = towerTopLayout(tower, units), reversed = towerTopLayout(tower, [...units].reverse());
    expect(layout).toEqual(reversed);
  });

  it("reports size, capacity and ownership separately, including each rejected member of a mixed selection", () => {
    const { game, tower } = field();
    const large = game.spawnUnit("player", "ancientStag", 1000, 1100); large.radius = 41;
    expect(tryPlayerCommand(game, "player", { type: "garrison", unitIds: [large.id], buildingId: tower.id })).toMatchObject({ ok: false, refusal: { reason: "garrison-body-size" } });
    const enemy = game.spawnUnit("enemy", "footman", 1000, 1100);
    expect(tryPlayerCommand(game, "enemy", { type: "garrison", unitIds: [enemy.id], buildingId: tower.id })).toMatchObject({ ok: false, refusal: { reason: "garrison-ownership", detail: { owner: "player" } } });
    const troops = ["footman", "footman", "worker", "ballista"].map(kind => game.spawnUnit("player", kind as UnitKind, 1100, 1100));
    expect(tryPlayerCommand(game, "player", { type: "garrison", unitIds: troops.map(unit => unit.id), buildingId: tower.id }).ok).toBe(true);
    expect(game.effects).toContainEqual(expect.objectContaining({ unitId: troops[2]!.id, refusal: { reason: "tower-full", detail: { buildingId: tower.id, used: 4, capacity: 4, required: 1 } } }));
    expect(game.effects).toContainEqual(expect.objectContaining({ unitId: troops[3]!.id, refusal: { reason: "garrison-mechanical", detail: { buildingId: tower.id } } }));
  });
});
