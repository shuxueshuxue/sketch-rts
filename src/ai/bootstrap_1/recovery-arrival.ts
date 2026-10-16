import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { buildingMoveArrival, createNativeQueryFrame, nativeAutomaticAttackIntent, type NativeQueryFrame } from '../../shared/sim';
import type { GameSnapshot, Unit } from '../../shared/types';
import { distance, type Point } from '../policy/spatial';

/** Filter only an estimated early arrival followed by native active pursuit.
 * Damage/room/healing checks remain the caller's job. The native snapshot map
 * already carries its current building overlay (raw saves must be restored).
 */
export function recoveryArrivalFilter(snapshot: GameSnapshot, patient: Unit, thinkTicks: number): (goal: Point) => boolean {
  let context: { frame: NativeQueryFrame; posed: Unit } | undefined;
  return goal => {
    if (snapshot.buildings.every(building => distance(goal, building)
      >= building.radius + patient.radius + MOVE_ORDER_ARRIVAL_RANGE)) return true;
    const arrival = buildingMoveArrival(snapshot, patient, goal, thinkTicks);
    // Idle acquisition sets an attack order; pursuit first runs a tick later.
    if (!arrival || arrival.movementTick + 2 > thinkTicks) return true;
    if (!context) {
      // Build once, only for an actually early nearby-building candidate.
      // Native snapshots contain their actual complete team map.
      const canonical = createNativeQueryFrame({ ...snapshot, teams: snapshot.teams! });
      const posed = { ...patient };
      const frame = { ...canonical, units: canonical.units.map(unit => unit.id === patient.id ? posed : unit), entityById: new Map(canonical.entityById) };
      frame.entityById!.set(patient.id, posed);
      context = { frame, posed };
      // Only this patient's pose/order/clocks are projected. All other bodies
      // and their native enemy bucket order stay at the observed snapshot.
      // This is not a forecast of future movement, damage or help calls.
    }
    const { frame, posed } = context;
    posed.x = arrival.point.x; posed.y = arrival.point.y;
    posed.cooldown = Math.max(0, patient.cooldown - arrival.movementTick - 1);
    posed.order = { type: 'idle' };
    const acquired = nativeAutomaticAttackIntent(frame, posed);
    if (acquired.action !== 'acquire') return true;
    posed.cooldown = Math.max(0, patient.cooldown - arrival.movementTick - 2);
    posed.order = { type: 'attack', targetId: acquired.targetId!, leashX: posed.x, leashY: posed.y };
    return nativeAutomaticAttackIntent(frame, posed).action !== 'pursue';
  };
}
