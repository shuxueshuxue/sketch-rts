import { describe, expect, it } from "vitest";
import type { Unit, UnitOrder } from "../shared/types";
import { UnitMotionSmoother } from "./unit-motion";

const TICK_MS = 50;
const idle: UnitOrder = { type: "idle" };
const charging: UnitOrder = { type: "charge", targetId: "foe", ticks: 1, resume: { type: "attack", targetId: "foe" } };
const attacking: UnitOrder = { type: "attack", targetId: "foe" };

const unit = (x: number, order: UnitOrder, id = "rider") => ({ id, x, y: 100, order }) as Unit;
const snap = (tick: number, ...units: Unit[]) => ({ tick, units });

describe("unit motion smoother", () => {
  it("draws a unit that is not charging where the snapshot puts it", () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(1, unit(100, idle)), 0);
    motion.update(snap(2, unit(104, attacking)), 50);
    expect(motion.position(unit(104, attacking), 60)).toEqual({ x: 104, y: 100 });
  });

  it("glides a charging rider from its last spot to the new one over the tick, by the frame clock", () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(1, unit(100, idle)), 0);
    const dashing = unit(130, charging);
    motion.update(snap(2, dashing), 50);
    expect(motion.position(dashing, 50)).toEqual({ x: 100, y: 100 });
    expect(motion.position(dashing, 75).x).toBeCloseTo(115);
    expect(motion.position(dashing, 100)).toEqual({ x: 130, y: 100 });
    expect(motion.position(dashing, 400)).toEqual({ x: 130, y: 100 });
  });

  it("draws the same tick again and again without restarting the glide (a recording at 60 fps)", () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(1, unit(100, idle)), 0);
    const dashing = unit(130, charging);
    const drawn: number[] = [];
    for (const now of [50, 66.7, 83.3]) {
      motion.update(snap(2, dashing), now);
      drawn.push(motion.position(dashing, now).x);
    }
    expect(drawn[0]).toBe(100);
    expect(drawn[1]).toBeCloseTo(110, 0);
    expect(drawn[2]).toBeCloseTo(120, 0);
  });

  it("carries on from where it was drawn when the next tick comes early, so the rider never jumps back", () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(1, unit(100, idle)), 0);
    motion.update(snap(2, unit(130, charging)), 50);
    // Tick 3 arrives halfway through tick 2's glide: the rider is drawn at 115 and glides on from there.
    const next = unit(160, charging);
    motion.update(snap(3, next), 75);
    expect(motion.position(next, 75).x).toBeCloseTo(115);
    expect(motion.position(next, 125)).toEqual({ x: 160, y: 100 });
  });

  it("smooths the step a rider lands on, then lets it go", () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(1, unit(100, idle)), 0);
    motion.update(snap(2, unit(130, charging)), 50);
    const landed = unit(150, attacking);
    motion.update(snap(3, landed), 100);
    expect(motion.position(landed, 100)).toEqual({ x: 130, y: 100 });
    expect(motion.position(landed, 125).x).toBeCloseTo(140);
    const fighting = unit(151, attacking);
    motion.update(snap(4, fighting), 150);
    expect(motion.position(fighting, 150)).toEqual({ x: 151, y: 100 });
  });

  it("stretches a glide over every tick a late snapshot covers, and glides across nothing longer (a new game)", () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(10, unit(100, charging)), 0);
    const later = unit(160, charging);
    motion.update(snap(12, later), 100);
    expect(motion.position(later, 150).x).toBeCloseTo(130);
    const reset = unit(900, charging);
    motion.update(snap(0, reset), 200);
    expect(motion.position(reset, 200)).toEqual({ x: 900, y: 100 });
  });
});
