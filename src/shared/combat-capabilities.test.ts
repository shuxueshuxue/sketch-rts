import { describe, expect, it } from "vitest";
import { resolveVariant, UNIT_DEFS, UPGRADE_DEFS } from "./catalog";
import { combatCapability } from "./combat-capabilities";
import { ITEM_DEFS } from "./equipment";
import { createUnit } from "./map";
import { createGame, spawnVariantUnit } from "./sim";
import { SHIP_WEAPONS, installedWeapons, shipMounts } from "./ship-equipment";
import type { WorldItem } from "./types";
import { veteranWeaponRange } from "./veteran-stats";

function match() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = [];
  return game;
}

describe("combat capability with learned range training", () => {
  it("uses current land damage, including unarmed and negative values, and clamps its range", () => {
    const unit = createUnit("fighter", "player", "footman", 0, 0);
    for (const [damage, armed] of [[17, true], [0, false], [-6, false], [-0, false]] as const) {
      unit.attackDamage = damage;
      unit.attackRange = -12;
      const capability = combatCapability({ items: [] }, unit);
      expect(capability).toEqual({ armed, range: 0, dps: 0 + (damage * 20) / UNIT_DEFS.footman.attackCooldown });
      if (Object.is(damage, -0)) expect(Object.is(capability.dps, 0)).toBe(true);
    }
  });

  it("combines upgraded variant damage and current range with the variant weapon cooldown", () => {
    const game = match();
    game.players.player!.upgrades.weaponTraining = 1;
    game.variants = { champion: resolveVariant({ base: "footman", attackDamage: 40, attackRange: 117, attackCooldown: 13 }) };
    const unit = spawnVariantUnit(game, "player", "champion", 500, 500);
    const damage = Math.round(40 * UPGRADE_DEFS.weaponTraining.levels[0]!.attackMultiplier!);
    expect(unit.attackDamage).toBe(damage);
    unit.attackRange = 250;
    unit.attackCooldown = 91;
    expect(combatCapability(game, unit)).toEqual({ armed: true, range: 250, dps: (damage * 20) / 13 });
  });

  it("retains equipped land weapon cooldown instead of the saved or catalog cooldown", () => {
    const unit = createUnit("swordsman", "player", "footman", 0, 0);
    const sword: WorldItem = { id: "sword", kind: "greatSword", carrierId: unit.id, slot: "carry0", x: 0, y: 0, cooldownRemaining: 0 };
    unit.hands = { right: sword.id };
    unit.attackDamage = 29;
    unit.attackRange = 73;
    unit.attackCooldown = 123;
    expect(combatCapability({ items: [sword] }, unit)).toEqual({ armed: true, range: 73, dps: (29 * 20) / ITEM_DEFS.greatSword.weapon!.cooldown });
  });

  it("projects each working mounted gun's learned range directly from a snapshot without a cached simulation frame", () => {
    const game = match();
    const ship = game.spawnUnit("player", "bombardShip", 900, 800);
    const mortar = installedWeapons(game, ship)[0]!;
    const cannon: WorldItem = { id: "side-cannon", kind: "shipCannon", shipId: ship.id, mountId: "port0", x: ship.x, y: ship.y, durability: 90, cooldownRemaining: 0 };
    game.items.push(cannon);
    ship.fittings!.push({ ...shipMounts(ship).find(mount => mount.id === "port0")!, id: cannon.id });
    ship.veteranSkill = "veteranSiegeDrill";
    expect(combatCapability(game, ship).range).toBeCloseTo(SHIP_WEAPONS.shipMortar.range * 1.1);
    mortar.durability = 0;
    expect(combatCapability(game, ship).range).toBeCloseTo(SHIP_WEAPONS.shipCannon.range * 1.1);
    cannon.durability = 0;
    expect(combatCapability(game, ship)).toEqual({ armed: false, range: 0, dps: 0 });
  });

  it("does not multiply already-derived land unit range a second time", () => {
    const game = match();
    const ballista = game.spawnUnit("player", "ballista", 500, 500);
    ballista.veteranSkill = "veteranSiegeDrill";
    ballista.attackRange = UNIT_DEFS.ballista.attackRange * 1.1;
    expect(combatCapability(game, ballista).range).toBe(ballista.attackRange);
    expect(combatCapability(game, ballista).range).not.toBeCloseTo(UNIT_DEFS.ballista.attackRange * 1.21);
  });

  it("preserves intrinsic cutter weapon capability when all mounted guns break", () => {
    const game = match();
    const cutter = game.spawnUnit("player", "cutter", 900, 800);
    cutter.veteranSkill = "veteranSteadyAim";
    const cannon: WorldItem = { id: "bow-cannon", kind: "shipCannon", shipId: cutter.id, mountId: "bow", x: cutter.x, y: cutter.y, durability: 0, cooldownRemaining: 0 };
    game.items.push(cannon);
    cutter.fittings = [{ ...shipMounts(cutter)[0]!, id: cannon.id }];
    expect(combatCapability(game, cutter).armed).toBe(true);
    expect(combatCapability(game, cutter).range).toBe(UNIT_DEFS.cutter.attackRange);
  });

  it("leaves unrelated learned skills and unlearned offers at base weapon range", () => {
    const base = SHIP_WEAPONS.shipCannon.range;
    expect(veteranWeaponRange({}, base)).toBe(base);
    expect(veteranWeaponRange({ veteranSkill: "veteranCommand" }, base)).toBe(base);
    expect(veteranWeaponRange({ veteranSkill: "veteranSteadyAim" }, base)).toBe(base);
    expect(veteranWeaponRange({ veteranSkill: "veteranSiegeDrill" }, base)).toBeCloseTo(base * 1.1);
  });
});
