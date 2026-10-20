import type { Building, GameSnapshot, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { nativeLandRoad } from '../policy/land-road';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { workerExposure } from '../situation/worker-exposure';
import { campClearanceTicks, workerLandDetour } from './camp-travel';

/** Hide useful construction travel behind an already committed clearing action.
 * This remains a rescue vacancy, not a resumed builder. It uses the same full
 * role envelope and compares projected completion times, without a retry clock. */
export function workerClearanceStage(snapshot: GameSnapshot, worker: Unit, memory: AiPolicyMemory, foes: readonly (Unit | Building)[]) {
  const travel = memory.unitClaims[worker.id]?.campTravel, state = memory.unitClaims[worker.id]?.interruption;
  const goal = travel?.clearingStaging;
  if (!state || state.phase !== 'life-saving-interruption' || !goal || Math.hypot(goal.x - worker.x, goal.y - worker.y) <= 80
    || workerExposure(snapshot, worker, goal, { foes }).length) return undefined;
  const camp = neutralCampExposure(snapshot).camps.find(camp => camp.memberIds.some(id => travel.clearingIds?.includes(id)));
  if (!camp) return undefined;
  const crew = snapshot.units.filter(unit => {
    const action = memory.unitClaims[unit.id]?.campTravel, command = action?.execution?.command;
    return unit.owner === worker.owner && unit.hp > 0 && unit.kind !== 'worker' && !!command
      && action?.clearingIds?.some(id => camp.memberIds.includes(id))
      && (unit.order.type === 'attack' && camp.memberIds.includes(unit.order.targetId)
        || (unit.order.type === 'attackMove' || unit.order.type === 'move') && (command.type === 'attackMove' || command.type === 'move')
          && Math.hypot(unit.order.x - command.x, unit.order.y - command.y) < 30);
  });
  const stagedCrew = crew.some(unit => !memory.unitClaims[unit.id]?.campTravel?.incidentalClear);
  const clearTicks = campClearanceTicks(snapshot, crew, camp.camp, stagedCrew ? goal : undefined);
  if (clearTicks === null) return undefined;
  const direct = nativeLandRoad(snapshot, worker, state.parent), onward = nativeLandRoad(snapshot, { ...worker, ...goal }, state.parent);
  if (!direct || !onward || onward.ticks >= direct.ticks) return undefined;
  const native = nativeLandRoad(snapshot, worker, goal);
  const road = native && !workerExposure(snapshot, worker, native.points, { foes, allowDeparture: true }).length
    ? native : workerLandDetour(snapshot, worker, goal, foes);
  return road && Math.max(clearTicks, road.ticks) + onward.ticks < clearTicks + direct.ticks ? road : undefined;
}
