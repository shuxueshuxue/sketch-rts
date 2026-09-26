import type { Unit, UnitOrder } from "../shared/types";

type Point = { x: number; y: number };

/** Unit models are painted facing right (1); -1 draws the mirror image, facing left. */
export type Facing = 1 | -1;

export type FacingState = { facing: Facing; anchorX: number };

// @@@unit-facing - A unit turns only once it has gone this far (world units) against the way it faces, so shoves and
// jitter in a crowd don't make it flicker. The anchor is the furthest point reached in the current direction.
export const FACING_TURN_DISTANCE = 3;

/**
 * Where a unit faces this frame: toward the enemy it is attacking, otherwise the way it last moved sideways. A unit
 * that stops keeps its facing.
 */
export function nextFacing(previous: FacingState | undefined, unit: Pick<Unit, "x" | "order">, target: Point | undefined): FacingState {
  if (target && Math.abs(target.x - unit.x) >= FACING_TURN_DISTANCE) return { facing: target.x < unit.x ? -1 : 1, anchorX: unit.x };
  if (!previous) return { facing: 1, anchorX: unit.x };
  if (previous.facing === 1) {
    if (unit.x <= previous.anchorX - FACING_TURN_DISTANCE) return { facing: -1, anchorX: unit.x };
    return { facing: 1, anchorX: Math.max(previous.anchorX, unit.x) };
  }
  if (unit.x >= previous.anchorX + FACING_TURN_DISTANCE) return { facing: 1, anchorX: unit.x };
  return { facing: -1, anchorX: Math.min(previous.anchorX, unit.x) };
}

export function attackTargetId(order: UnitOrder) {
  return order.type === "attack" || order.type === "attackMove" ? order.targetId : undefined;
}

/** Remembers each unit's facing between frames; units that are gone are forgotten. */
export class UnitFacingTracker {
  private states = new Map<string, FacingState>();

  update(units: readonly Unit[], locate: (id: string) => Point | undefined) {
    const next = new Map<string, FacingState>();
    for (const unit of units) {
      const targetId = attackTargetId(unit.order);
      next.set(unit.id, nextFacing(this.states.get(unit.id), unit, targetId ? locate(targetId) : undefined));
    }
    this.states = next;
  }

  facing(unitId: string): Facing {
    return this.states.get(unitId)?.facing ?? 1;
  }
}
