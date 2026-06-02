import { describe, expect, it } from "vitest";
import { armyPower } from "./combat-math";
import type { Unit } from "../../shared/types";

describe("AI combat math", () => {
  it("keeps wounded living units valuable for strategic army comparisons", () => {
    const frontliner = unit({ hp: 80, maxHp: 100, attackDamage: 18, attackRange: 64 });
    const woundedArcher = unit({ hp: 30, maxHp: 60, attackDamage: 12, attackRange: 360 });

    expect(armyPower([frontliner, woundedArcher])).toBeCloseTo(1 * (1 + 18 / 18 + 64 / 260) + 1 * (1 + 12 / 18 + 360 / 260));
  });
});

function unit(overrides: Partial<Unit>): Unit {
  return {
    id: "unit",
    owner: "player",
    kind: "footman",
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    speed: 1,
    attackDamage: 10,
    attackRange: 64,
    attackCooldown: 1,
    cooldown: 0,
    radius: 10,
    carryingGold: 0,
    kills: 0,
    xp: 0,
    level: 0,
    effects: [],
    order: { type: "idle" },
    ...overrides,
  };
}
