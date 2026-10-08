import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "./catalog";
import { combatCapability } from "./combat-capabilities";
import { createGame } from "./sim";
import { SHIP_WEAPONS, installedWeapons, shipMounts } from "./ship-equipment";
import type { WorldItem } from "./types";
import { veteranWeaponRange } from "./veteran-stats";

function match() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = [];
  return game;
}

describe("combat capability with learned range training", () => {
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
