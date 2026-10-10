import { describe, expect, it } from "vitest";
import { aimAt, invalidateMovedAim } from "./aiming";
import { UNIT_DEFS } from "./catalog";
import { createUnit } from "./map";
import type { UnitAim } from "./types";

const target = { x: 1_288, y: 1_000 };
function prepared(tolerance = 6) {
  const unit = createUnit("shooter", "p1", "archer", 1_000, 1_000);
  const rules = { ...UNIT_DEFS.archer, aimMoveTolerance: tolerance };
  aimAt(unit, rules, target, 1);
  return { unit, rules };
}

describe("aim displacement invalidation", () => {
  it("retains stationary reticle state but clears it after losing a ranged weapon", () => {
    const { unit, rules } = prepared(0);
    const aim = unit.aim!, before = { ...aim };
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBe(aim);
    expect(unit.aim).toStrictEqual(before);

    for (const unavailable of [
      UNIT_DEFS.footman,
      { ...rules, attackDamage: 0 },
      { ...rules, attackRange: 80 },
      { ...rules, naval: true as const },
    ]) {
      unit.aim = { ...before };
      invalidateMovedAim(unit, unavailable);
      expect(unit.aim).toBeUndefined();
    }
  });

  it("retains radial boundary progress and restarts beyond a custom tolerance", () => {
    const { unit, rules } = prepared(5);
    const aim = unit.aim!, before = { ...aim };
    unit.x += 3;
    unit.y += 4;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBe(aim);
    expect(unit.aim).toStrictEqual(before);

    unit.x += .01;
    aimAt(unit, rules, target, 2);
    expect(unit.aim).not.toBe(aim);
    expect(unit.aim).toMatchObject({ anchorX: unit.x, anchorY: unit.y, updatedTick: 2 });

    const negative = prepared(-1);
    invalidateMovedAim(negative.unit, negative.rules);
    expect(negative.unit.aim).toBeUndefined();
    const nan = prepared(NaN), retained = nan.unit.aim;
    nan.unit.x += 100;
    invalidateMovedAim(nan.unit, nan.rules);
    expect(nan.unit.aim).toBe(retained);
  });

  it("measures crew movement on the deck while the hull moves in world space", () => {
    const { unit, rules } = prepared(5);
    unit.deck = { shipId: "hull", x: 12, y: -4 };
    unit.aim = undefined;
    aimAt(unit, rules, target, 2);
    const aim = unit.aim!, before = { ...aim };
    unit.x += 500;
    unit.y += 500;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBe(aim);
    expect(unit.aim).toStrictEqual(before);
    unit.deck.x += 3;
    unit.deck.y += 4;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBe(aim);
    unit.deck.x += .01;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBeUndefined();

    // Older reticles without deck anchors use the current local position.
    unit.aim = { ...before };
    delete unit.aim.anchorDeckX;
    delete unit.aim.anchorDeckY;
    const olderAim = unit.aim;
    unit.deck.x += 100;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBe(olderAim);
  });

  it("preserves missing world anchors, signed zero and nonfinite displacement semantics", () => {
    const { unit, rules } = prepared(0);
    const restoredAim = unit.aim!;
    delete (restoredAim as Partial<UnitAim>).anchorX;
    unit.x += 100;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBe(restoredAim);

    restoredAim.anchorX = NaN;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBe(restoredAim);
    unit.x = restoredAim.anchorX = Infinity;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBe(restoredAim);
    unit.x = -0;
    restoredAim.anchorX = 0;
    unit.y = 0;
    restoredAim.anchorY = -0;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBe(restoredAim);
    expect(restoredAim.anchorY).toBe(-0);

    unit.x = NaN;
    unit.y = Infinity;
    invalidateMovedAim(unit, rules);
    expect(unit.aim).toBeUndefined();
  });
});
