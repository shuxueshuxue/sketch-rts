import { describe, expect, it } from "vitest";
import { IDLE_FRAME, UnitAnimationTracker } from "./unit-animation";
import type { Unit } from "../shared/types";

const soldier = (overrides: Partial<Unit> = {}): Unit => ({
  id: "soldier", owner: "player", kind: "footman", x: 100, y: 100,
  hp: 100, maxHp: 100, speed: 80, attackDamage: 10, attackRange: 30,
  attackCooldown: 20, cooldown: 0, radius: 12, carryingGold: 0,
  kills: 0, xp: 0, level: 0, effects: [], order: { type: "idle" }, ...overrides,
});
const snap = (tick: number, ...units: Unit[]) => ({ tick, units });

describe("unit pose history", () => {
  it("animates observed movement, not blocked move/attack orders", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier({ order: { type: "attack", targetId: "foe" } });
    tracker.update(snap(1, unit), 0);
    tracker.update(snap(2, unit), 50);
    expect(tracker.frame(unit, 75)).toEqual(IDLE_FRAME);
    const moved = soldier({ x: 104, order: unit.order });
    tracker.update(snap(3, moved), 100);
    expect(tracker.frame(moved, 125).mode).toBe("walk");
    tracker.update(snap(4, moved), 150);
    expect(tracker.frame(moved, 175)).toEqual(IDLE_FRAME);
  });

  it("starts a strike on a weapon cooldown rise, including hold-position fire, and does not restart it", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier({ order: { type: "hold", x: 100, y: 100 } });
    tracker.update(snap(0, unit), 0);
    const struck = soldier({ ...unit, cooldown: 20 });
    tracker.update(snap(1, struck), 50);
    expect(tracker.frame(struck, 50)).toEqual({ mode: "attack", frame: 0 });
    tracker.update(snap(1, struck), 75);
    expect(tracker.frame(struck, 90).mode).toBe("attack");
    tracker.update(snap(4, soldier({ ...unit, cooldown: 17 })), 200);
    expect(tracker.frame(unit, 200)).toEqual({ mode: "attack", frame: 3 });
    tracker.update(snap(8, soldier({ ...unit, cooldown: 13 })), 400);
    expect(tracker.frame(unit, 400)).toEqual(IDLE_FRAME);
  });

  it("separates spell cooldowns from weapon fire and prioritizes a simultaneous cast", () => {
    const tracker = new UnitAnimationTracker();
    const priest = soldier({ kind: "priest" });
    tracker.update(snap(1, priest), 0);
    const cast = soldier({ ...priest, cooldown: 20, abilityCooldowns: { heal: 240 } });
    tracker.update(snap(2, cast), 50);
    expect(tracker.frame(cast, 50).mode).toBe("cast");
    tracker.update(snap(5, soldier({ ...cast, cooldown: 17, abilityCooldowns: { heal: 237 } })), 200);
    expect(tracker.frame(cast, 200)).toEqual({ mode: "cast", frame: 1 });
  });

  it("does not treat repair or charge cooldowns as spell/weapon animations", () => {
    const tracker = new UnitAnimationTracker();
    const worker = soldier({ kind: "worker", order: { type: "repair", buildingId: "hall" } });
    const knight = soldier({ id: "knight", kind: "knight" });
    tracker.update(snap(0, worker, knight), 0);
    tracker.update(snap(1, { ...worker, cooldown: 12 }, { ...knight, abilityCooldowns: { charge: 100 } }), 50);
    expect(tracker.frame(worker, 60)).toEqual(IDLE_FRAME);
    expect(tracker.frame(knight, 60)).toEqual(IDLE_FRAME);
  });

  it("freezes on stalled snapshots and derives poses independently of wall-clock origin", () => {
    const a = new UnitAnimationTracker(), b = new UnitAnimationTracker();
    const unit = soldier();
    const moved = soldier({ x: 104 });
    a.update(snap(1, unit), 0); b.update(snap(1, unit), 10_000);
    a.update(snap(2, moved), 50); b.update(snap(2, moved), 10_050);
    expect(a.frame(moved, 80)).toEqual(b.frame(moved, 10_080));
    expect(a.frame(moved, 150)).toEqual(a.frame(moved, 10_000));
  });

  it("drops dead units and discards history on rewind, a long gap or teleport", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier();
    tracker.update(snap(10, unit), 0);
    tracker.update(snap(11, soldier({ cooldown: 20 })), 50);
    tracker.update(snap(0, unit), 100);
    expect(tracker.frame(unit, 100)).toEqual(IDLE_FRAME);
    tracker.update(snap(1, soldier({ x: 1000 })), 150);
    expect(tracker.frame(unit, 150)).toEqual(IDLE_FRAME);
    tracker.update(snap(20, soldier({ x: 1010, cooldown: 20 })), 200);
    expect(tracker.frame(unit, 200)).toEqual(IDLE_FRAME);
    tracker.update(snap(21), 250);
    expect(tracker.frame(unit, 250)).toEqual(IDLE_FRAME);
  });

  it("does not march during knockback or animate a stunned unit", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier();
    tracker.update(snap(0, unit), 0);
    tracker.update(snap(1, soldier({ x: 110, pushX: 10 })), 50);
    expect(tracker.frame(unit, 50)).toEqual(IDLE_FRAME);
    tracker.update(snap(2, soldier({ x: 112, cooldown: 20, effects: [{ type: "stun", remaining: 5 }] })), 100);
    expect(tracker.frame(unit, 100)).toEqual(IDLE_FRAME);
  });

  it("never mutates a simulation snapshot", () => {
    const tracker = new UnitAnimationTracker();
    const unit = soldier({ abilityCooldowns: { heal: 15 } });
    const before = JSON.stringify(unit);
    tracker.update(snap(0, unit), 0);
    tracker.frame(unit, 30);
    expect(JSON.stringify(unit)).toBe(before);
    unit.abilityCooldowns!.heal = 240;
    tracker.update(snap(1, unit), 50);
    expect(tracker.frame(unit, 50).mode).toBe("cast");
  });
});
