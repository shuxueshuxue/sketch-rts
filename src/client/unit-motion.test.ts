import { describe, expect, it } from "vitest";
import type { Unit, UnitOrder } from "../shared/types";
import { UnitMotionSmoother } from "./unit-motion";

const TICK_MS = 50;
const idle: UnitOrder = { type: "idle" };
const charging: UnitOrder = { type: "charge", targetId: "foe", resume: { type: "attack", targetId: "foe" } };
const attacking: UnitOrder = { type: "attack", targetId: "foe" };

const unit = (x: number, order: UnitOrder, id = "rider") => ({ id, x, y: 100, order }) as Unit;
const snap = (tick: number, ...units: Unit[]) => ({ tick, units });

describe("unit motion smoother", () => {
  it('interpolates yaw across angle wrap and stops at the received pose',()=>{
    const motion=new UnitMotionSmoother(TICK_MS),ship={...unit(100,idle),sailing:{heading:Math.PI-.02,speed:0,load:0,balance:0}};
    motion.update(snap(1,ship),0);const next={...ship,sailing:{...ship.sailing,heading:-Math.PI+.02}};
    motion.update(snap(2,next),50);
    expect(motion.heading(next,75)).toBeCloseTo(Math.PI,8);
    expect(motion.heading(next,100)).toBeCloseTo(Math.PI+.02,8);
    expect(motion.heading(next,400)).toBeCloseTo(Math.PI+.02,8);
    expect(next.sailing.heading).toBe(-Math.PI+.02);
  });
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

  it('preserves the full path for a charge whose endpoints are outside the viewport', () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(1, unit(-100, idle)), 0);
    const rider = unit(1100, charging);
    motion.update(snap(2, rider), 50);
    const bounds = motion.bounds(rider);
    expect(bounds?.from).toEqual({ x: -100, y: 100 });
    expect(bounds?.to).toEqual({ x: 1100, y: 100 });
    expect(motion.bounds(rider)).toBe(bounds);
    expect(motion.position(rider, 75)).toEqual({ x: 500, y: 100 });
    motion.update(snap(2, rider), 80);
    expect(motion.bounds(rider)).toBe(bounds);
    expect(motion.position(rider, 80)).toEqual({ x: 620, y: 100 });
  });

  it('reuses history across successive early ticks without overwriting glide endpoints', () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(1, unit(100, idle)), 0);
    const second = unit(130, charging);
    motion.update(snap(2, second), 50);
    const secondPath = motion.bounds(second);
    const third = unit(160, charging);
    motion.update(snap(3, third), 75);
    expect(secondPath?.from.x).toBe(100);
    expect(secondPath?.to.x).toBe(130);
    expect(motion.position(third, 75).x).toBe(115);
    const fourth = unit(190, charging);
    motion.update(snap(4, fourth), 100);
    expect(motion.position(fourth, 100).x).toBe(137.5);
    expect(motion.position(fourth, 125).x).toBe(163.75);
    expect(motion.position(fourth, 150).x).toBe(190);
  });

  it('forgets removed units rather than gliding from a reused history buffer', () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(1, unit(100, idle)), 0);
    motion.update(snap(2, unit(130, charging)), 50);
    motion.update(snap(3), 100);
    expect(motion.bounds({ id: 'rider' })).toBeUndefined();
    const returned = unit(900, charging);
    motion.update(snap(4, returned), 150);
    expect(motion.position(returned, 150)).toEqual({ x: 900, y: 100 });
  });

  it('clears old paths across a long resync and continues from the resynced position', () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    motion.update(snap(1, unit(100, idle)), 0);
    motion.update(snap(2, unit(130, charging)), 50);
    const resynced = unit(900, charging);
    motion.update(snap(20, resynced), 100);
    expect(motion.bounds(resynced)).toBeUndefined();
    const next = unit(930, charging);
    motion.update(snap(21, next), 150);
    expect(motion.position(next, 150)).toEqual({ x: 900, y: 100 });
    expect(motion.position(next, 175)).toEqual({ x: 915, y: 100 });
  });

  it('removes stale sailing headings from reused land history', () => {
    const motion = new UnitMotionSmoother(TICK_MS);
    const ship = { ...unit(100, idle), sailing: { heading: 0, speed: 0, load: 0, balance: 0 } };
    motion.update(snap(1, ship), 0);
    motion.update(snap(2, unit(120, idle)), 50);
    const sailingAgain = { ...ship, x: 140, sailing: { ...ship.sailing, heading: Math.PI / 2 } };
    motion.update(snap(3, sailingAgain), 100);
    expect(motion.heading(sailingAgain, 100)).toBe(Math.PI / 2);
    expect(motion.bounds(sailingAgain)?.from).toEqual({ x: 120, y: 100 });
  });
});
