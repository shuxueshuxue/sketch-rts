import { describe, expect, it } from "vitest";
import { abilityCommandState, autocastSwitch, autocastToggle, mercenaryHireCommandState, trainCommandState } from "./command-button-state";
import { TIER_SUPPLY_CAP } from "../shared/catalog";
import type { MercenaryCamp, PlayerState, Unit } from "../shared/types";

describe("command button state", () => {
  it("greys a unit whose tier is locked, with the supply cap it waits for, and hides one the player cannot train", () => {
    const [advanced, elite] = [TIER_SUPPLY_CAP[2], TIER_SUPPLY_CAP[3]];
    const early = playerState({ gold: 500, supplyUsed: 8, supplyCap: advanced - 1 });
    expect(trainCommandState("summoner", early, true)).toEqual({ visible: true, enabled: false, reason: "tier", supplyCap: advanced });
    expect(trainCommandState("knight", playerState({ gold: 500, supplyUsed: 8, supplyCap: elite - 1 }), true)).toEqual({ visible: true, enabled: false, reason: "tier", supplyCap: elite });
    expect(trainCommandState("footman", early, true)).toEqual({ visible: true, enabled: true });
    expect(trainCommandState("summoner", playerState({ gold: 500, supplyUsed: 8, supplyCap: advanced }), true)).toEqual({ visible: true, enabled: true });
    expect(trainCommandState("summoner", early, false)).toEqual({ visible: false, enabled: false });
  });

  it("keeps a selected caster ability visible while disabling it during cooldown", () => {
    expect(abilityCommandState([unit("priest", { heal: 75 })], "heal")).toEqual({
      visible: true,
      enabled: false,
      cooldownTicks: 75,
      reason: "cooldown",
      autocast: "on",
    });
  });

  it("enables a caster's spell while only its weapon is cooling down", () => {
    const priest = { ...unit("priest", undefined), cooldown: 20 };
    expect(abilityCommandState([priest], "heal")).toEqual({ visible: true, enabled: true, autocast: "on" });
  });

  it("shows the charge on a rider's card, with its autocast switch read over the whole selection", () => {
    const raider = unit("raider", undefined);
    const knight = { ...unit("knight", undefined), id: "knight-1", autocast: { charge: false } };
    expect(abilityCommandState([raider], "charge")).toEqual({ visible: true, enabled: true, autocast: "on" });
    expect(abilityCommandState([raider], "charge", [raider, knight])).toEqual({ visible: true, enabled: true, autocast: "mixed" });
    expect(abilityCommandState([unit("footman", undefined)], "charge", [raider])).toEqual({ visible: false, enabled: false });
  });

  it("switches autocast Warcraft III's way: all on unless every selected caster already has it on", () => {
    const on = (id: string) => ({ ...unit("raider", undefined), id });
    const off = (id: string) => ({ ...unit("knight", undefined), id, autocast: { charge: false } });
    const footman = unit("footman", undefined);

    expect(autocastSwitch([on("a"), on("b")], "charge")).toBe("on");
    expect(autocastToggle([on("a"), on("b"), footman], "charge")).toEqual({ unitIds: ["a", "b"], enabled: false });

    expect(autocastSwitch([on("a"), off("b")], "charge")).toBe("mixed");
    expect(autocastToggle([on("a"), off("b")], "charge")).toEqual({ unitIds: ["a", "b"], enabled: true });

    expect(autocastSwitch([off("a"), off("b")], "charge")).toBe("off");
    expect(autocastToggle([off("a"), off("b")], "charge")).toEqual({ unitIds: ["a", "b"], enabled: true });

    expect(autocastSwitch([footman], "charge")).toBeUndefined();
    expect(autocastToggle([footman], "charge")).toBeUndefined();
    // A switch only speaks for the ability it names: a priest's heal switched off leaves a witch's curse on.
    expect(autocastSwitch([{ ...unit("priest", undefined), autocast: { heal: false } }, unit("witch", undefined)], "curse")).toBe("on");
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

function unit(kind: Unit["kind"], abilityCooldowns: Unit["abilityCooldowns"]): Unit {
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
    cooldown: 0,
    ...(abilityCooldowns ? { abilityCooldowns } : {}),
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
    upgrades: { weaponTraining: 0, reinforcedPlating: 0, buildingDurability: 0, speedTraining: 0, rangeTraining: 0, leadership: 0 },
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
