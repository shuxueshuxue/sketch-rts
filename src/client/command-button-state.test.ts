import { describe, expect, it } from "vitest";
import { abilityCommandState, mercenaryHireCommandState } from "./command-button-state";
import type { MercenaryCamp, PlayerState, Unit } from "../shared/types";

describe("command button state", () => {
  it("keeps a selected caster ability visible while disabling it during cooldown", () => {
    expect(abilityCommandState([unit("priest", 75)], "heal")).toEqual({
      visible: true,
      enabled: false,
      cooldownTicks: 75,
      reason: "cooldown",
    });
  });

  it("keeps selected mercenary camps visible while explaining unavailable hire states", () => {
    const player = playerState({ gold: 200, supplyUsed: 10, supplyCap: 10 });
    const camp = mercenaryCamp({ cooldownRemaining: 35 });

    expect(mercenaryHireCommandState({ camp, player, hasFriendlyUnitAtCamp: true })).toEqual({
      visible: true,
      enabled: false,
      cooldownTicks: 35,
      reason: "cooldown",
    });

    expect(mercenaryHireCommandState({ camp: { ...camp, cooldownRemaining: 0 }, player, hasFriendlyUnitAtCamp: true })).toEqual({
      visible: true,
      enabled: false,
      reason: "supply",
    });
  });
});

function unit(kind: Unit["kind"], cooldown: number): Unit {
  return {
    id: `${kind}-1`,
    owner: "player",
    kind,
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    speed: 3,
    attackDamage: 8,
    attackRange: 90,
    attackCooldown: 10,
    cooldown,
    radius: 14,
    carryingGold: 0,
    kills: 0,
    xp: 0,
    level: 0,
    effects: [],
    order: { type: "idle" },
  };
}

function playerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    race: "grove",
    gold: 500,
    supplyUsed: 0,
    supplyCap: 12,
    upgrades: { weaponTraining: 0, reinforcedPlating: 0, buildingDurability: 0 },
    ...overrides,
  };
}

function mercenaryCamp(overrides: Partial<MercenaryCamp> = {}): MercenaryCamp {
  return {
    id: "camp",
    x: 0,
    y: 0,
    radius: 54,
    hireKind: "mercenary",
    cost: 160,
    stock: 1,
    cooldown: 90,
    cooldownRemaining: 0,
    ...overrides,
  };
}
