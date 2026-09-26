import { describe, expect, it } from "vitest";
import type { Unit, UnitOrder } from "../shared/types";
import { FACING_TURN_DISTANCE, UnitFacingTracker, nextFacing, type FacingState } from "./unit-facing";

const idle: UnitOrder = { type: "idle" };
const at = (x: number, order: UnitOrder = idle) => ({ x, order });

function walk(xs: number[], start?: FacingState) {
  let state = start;
  const facings: number[] = [];
  for (const x of xs) {
    state = nextFacing(state, at(x), undefined);
    facings.push(state.facing);
  }
  return facings;
}

describe("unit facing", () => {
  it("starts facing the way the model is painted", () => {
    expect(nextFacing(undefined, at(100), undefined).facing).toBe(1);
  });

  it("turns left once it has walked left past the turn distance, and back right the same way", () => {
    const step = FACING_TURN_DISTANCE;
    expect(walk([100, 100 - step / 2, 100 - step])).toEqual([1, 1, -1]);
    expect(walk([100, 100 - step, 100 - step / 2, 100])).toEqual([1, -1, -1, 1]);
  });

  it("does not flicker when shoved back and forth by less than the turn distance", () => {
    const jitter = FACING_TURN_DISTANCE * 0.4;
    const xs = [100, 100 - jitter, 100 + jitter, 100 - jitter, 100 + jitter, 100 - jitter];
    expect(new Set(walk(xs))).toEqual(new Set([1]));
  });

  it("keeps its facing when it stops", () => {
    const step = FACING_TURN_DISTANCE;
    expect(walk([100, 100 - step * 2, 100 - step * 2, 100 - step * 2])).toEqual([1, -1, -1, -1]);
  });

  it("measures the turn from the furthest point reached, so a small drift back after a long walk does not turn it", () => {
    const step = FACING_TURN_DISTANCE;
    expect(walk([100, 100 + step * 10, 100 + step * 10 - step * 0.5])).toEqual([1, 1, 1]);
  });

  it("faces the enemy it is attacking even while standing still", () => {
    const attack: UnitOrder = { type: "attack", targetId: "enemy" };
    const walkingRight = nextFacing(undefined, at(100), undefined);
    expect(nextFacing(walkingRight, at(100, attack), { x: 100 - FACING_TURN_DISTANCE * 10, y: 0 }).facing).toBe(-1);
    const attackMove: UnitOrder = { type: "attackMove", x: 0, y: 0, targetId: "enemy" };
    expect(nextFacing({ facing: -1, anchorX: 100 }, at(100, attackMove), { x: 100 + FACING_TURN_DISTANCE * 10, y: 0 }).facing).toBe(1);
  });

  it("remembers facing per unit between frames and forgets units that are gone", () => {
    const tracker = new UnitFacingTracker();
    const unit = (id: string, x: number) => ({ id, x, y: 0, order: idle }) as Unit;
    tracker.update([unit("a", 100), unit("b", 100)], () => undefined);
    tracker.update([unit("a", 100 - FACING_TURN_DISTANCE * 2), unit("b", 100 + FACING_TURN_DISTANCE * 2)], () => undefined);
    expect(tracker.facing("a")).toBe(-1);
    expect(tracker.facing("b")).toBe(1);
    tracker.update([unit("b", 100)], () => undefined);
    expect(tracker.facing("a")).toBe(1);
  });
});
