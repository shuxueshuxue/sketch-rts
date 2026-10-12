import type { GameSnapshot, Unit, UnitOrder } from "../shared/types";

type Point = { x: number; y: number; height?: number };

/** Unit models are painted facing right (1); -1 draws the mirror image, facing left. */
export type Facing = 1 | -1;

export type FacingState = { facing: Facing; anchorX: number };

// @@@unit-facing - A unit turns only once it has gone this far (world units) against the way it faces, so shoves and
// jitter in a crowd don't make it flicker. The anchor is the furthest point reached in the current direction.
export const FACING_TURN_DISTANCE = 3;

/**
 * Where a unit faces this frame: toward the enemy it is attacking or charging, otherwise the way it last moved sideways.
 * A unit that stops keeps its facing.
 */
export function nextFacing(previous: FacingState | undefined, unit: Pick<Unit, "x" | "order"> & Partial<Pick<Unit,"y">>, target: Point | undefined): FacingState {
  if (target && Math.abs(target.x - unit.x) >= Math.max(FACING_TURN_DISTANCE,Math.abs(target.y-(unit.y??target.y))*.08)) return { facing: target.x < unit.x ? -1 : 1, anchorX: unit.x };
  if (!previous) return { facing: 1, anchorX: unit.x };
  if (previous.facing === 1) {
    if (unit.x <= previous.anchorX - FACING_TURN_DISTANCE) return { facing: -1, anchorX: unit.x };
    return { facing: 1, anchorX: Math.max(previous.anchorX, unit.x) };
  }
  if (unit.x >= previous.anchorX + FACING_TURN_DISTANCE) return { facing: 1, anchorX: unit.x };
  return { facing: -1, anchorX: Math.min(previous.anchorX, unit.x) };
}

export function attackTargetId(order: UnitOrder) {
  return order.type === "attack" || order.type === "attackMove" || order.type === "charge" ? order.targetId : undefined;
}

/** Construction and repair face their physical target just like an attack. */
export function interactionTargetId(order: UnitOrder) {
  return order.type === 'repair' ? order.buildingId : order.type === 'repairUnit' || order.type === 'repairShip' ? order.targetId : attackTargetId(order);
}

/** Remembers each unit's facing between frames; units that are gone are forgotten. */
export class UnitFacingTracker {
  private states = new Map<string, FacingState>();
  private beforeUpdate = new Map<string,FacingState>();
  private actions = new Map<string,{direction:Point;facing:Facing}>();
  private snapshot: Pick<GameSnapshot, 'tick' | 'units' | 'buildings'> | undefined;
  private snapshotTick: number | undefined;
  private snapshotUnits: readonly Unit[] | undefined;
  private snapshotUnitCount = 0;
  private snapshotBuildings: GameSnapshot['buildings'] | undefined;
  private snapshotBuildingCount = 0;

  /** Track every unit once per received snapshot. A new command snapshot can
   * change targets without advancing its tick; recordings can advance a mutable
   * snapshot in place. Repeated drawing frames retain actionFacing's turns. */
  updateSnapshot(snapshot: Pick<GameSnapshot, 'tick' | 'units' | 'buildings'>, locate: (id: string) => Point | undefined) {
    if (this.snapshot === snapshot && this.snapshotTick === snapshot.tick &&
      this.snapshotUnits === snapshot.units && this.snapshotUnitCount === snapshot.units.length &&
      this.snapshotBuildings === snapshot.buildings && this.snapshotBuildingCount === snapshot.buildings.length) return;
    this.update(snapshot.units, locate);
    this.snapshot = snapshot;
    this.snapshotTick = snapshot.tick;
    this.snapshotUnits = snapshot.units;
    this.snapshotUnitCount = snapshot.units.length;
    this.snapshotBuildings = snapshot.buildings;
    this.snapshotBuildingCount = snapshot.buildings.length;
  }

  update(units: readonly Unit[], locate: (id: string) => Point | undefined) {
    // Direct callers may mutate orders/positions in place. This entry point
    // always updates, and invalidates the snapshot fast path.
    this.snapshot = undefined;
    const next = this.beforeUpdate;
    next.clear();
    for (const unit of units) {
      const targetId = interactionTargetId(unit.order);
      const aiming = unit.aim && (unit.order.type === "attack" || unit.order.type === "attackMove" || unit.order.type === "hold" || unit.order.type === "aim" || unit.order.type === "cast");
      next.set(unit.id, nextFacing(this.states.get(unit.id), unit, aiming ? unit.aim : targetId ? locate(targetId) : undefined));
    }
    this.beforeUpdate=this.states;
    this.states = next;
    for(const id of this.actions.keys())if(!next.has(id))this.actions.delete(id);
  }

  /** A release owns its facing until recovery completes, even when its victim
   * dies or a new order points behind it. Vertical actions keep their initial side. */
  actionFacing(unitId:string,direction:Point|undefined,projectVector:(point:Point)=>Point=point=>point,fallback?:Facing):Facing {
    if(!direction){this.actions.delete(unitId);return fallback??this.facing(unitId);}
    const old=this.actions.get(unitId);
    if(old?.direction===direction)return old.facing;
    const vector=projectVector(direction);
    const facing=Math.abs(vector.x)>=Math.max(1,Math.abs(vector.y)*.08)?(vector.x<0?-1:1):old?.facing??fallback??this.beforeUpdate.get(unitId)?.facing??this.facing(unitId);
    this.actions.set(unitId,{direction,facing});
    // A real release is also a turn. Hold/idle orders have no target to update
    // the resting side, so a temporary action-only mirror would snap back after
    // every counterattack. Later movement or a new target can still turn it.
    const state=this.states.get(unitId);
    if(state)this.states.set(unitId,{...state,facing});
    return facing;
  }

  /** Read the latched release side without changing the current action lock. */
  releaseFacing(unitId:string):Facing { return this.actions.get(unitId)?.facing??this.facing(unitId); }

  facing(unitId: string): Facing {
    return this.states.get(unitId)?.facing ?? 1;
  }
}
