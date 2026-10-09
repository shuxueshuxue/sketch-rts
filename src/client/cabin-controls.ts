import { cabinEntryRefusal, cabinExitPoint, cabinGroupSelection, cabinSpaceRequired, isInCabin, shipCabinCapacity, shipCabinUsage } from '../shared/ship-cabin';
import { canEquip } from '../shared/equipment';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../shared/types';

type CabinSnapshot = Pick<GameSnapshot, 'units' | 'teams' | 'variants'>;
export type CabinQuota = { used: number; capacity: number; required: number };
export type CabinAction = { type: 'enterCabin' | 'leaveCabin'; unitIds: string[]; enabled: boolean; quota?: CabinQuota; problem?: 'full' | 'unavailable' | 'unsupported' | 'blocked' };

/** A mixed selection returns sheltered people first; another click can shelter
 * the people still on deck. Commands never pull nearby shore units aboard. */
export function cabinAction(snapshot: CabinSnapshot, owner: PlayerId, units: readonly Unit[]): CabinAction | undefined {
  const own = units.filter(unit => unit.owner === owner && unit.hp > 0);
  const inside = own.filter(isInCabin);
  if (inside.length) {
    const leaving=inside.filter(unit=>{const ship=snapshot.units.find(ship=>ship.id===unit.cabin!.shipId);return !!ship&&!!cabinExitPoint(snapshot,ship,unit);});
    return leaving.length ? {type:'leaveCabin',unitIds:leaving.map(unit=>unit.id),enabled:true}
      : {type:'leaveCabin',unitIds:inside.map(unit=>unit.id),enabled:false,problem:'blocked'};
  }
  const aboard = own.filter(unit => canEquip(unit) && unit.deck && snapshot.units.some(ship => ship.id === unit.deck!.shipId && shipCabinCapacity(ship) > 0));
  if (!aboard.length) return undefined;
  const ships = [...new Set(aboard.map(unit => unit.deck!.shipId))].map(id => snapshot.units.find(ship => ship.id === id)!);
  const quota = ships.reduce((sum, ship) => {
    const usage = shipCabinUsage(snapshot, ship);
    return { ...sum, used: sum.used + usage.used, capacity: sum.capacity + usage.capacity };
  }, { used: 0, capacity: 0, required: aboard.reduce((sum, unit) => sum + cabinSpaceRequired(snapshot, unit), 0) });
  const allowed = cabinGroupSelection(snapshot, aboard);
  if (allowed.length) return { type: 'enterCabin', unitIds: allowed, enabled: true, quota };
  const refusals = aboard.map(unit => cabinEntryRefusal(snapshot, unit));
  const supported = refusals.filter(reason => reason !== 'unsupported');
  const problem = !supported.length ? 'unsupported' : supported.every(reason => reason === 'unavailable') ? 'unavailable'
    : supported.includes('capacity') ? 'full' : 'blocked';
  return { type: 'enterCabin', unitIds: aboard.map(unit => unit.id), enabled: false, quota, problem };
}

export function cabinCommand(action: CabinAction | undefined): GameCommand | undefined {
  return action?.enabled ? { type: action.type, unitIds: action.unitIds } : undefined;
}

export function cabinStatus(unit: Unit, zh: boolean) {
  return isInCabin(unit) ? unit.cabin?.breached ? zh ? '舱室失守 · 等待出舱' : 'Cabin breached · Waiting to exit' : zh ? '舱内' : 'In cabin' : '';
}

export function cabinQuotaText(quota: CabinQuota, zh: boolean, selected = false): string {
  return `${zh ? '舱容' : 'Cabin capacity'} ${quota.used} / ${quota.capacity}${selected ? ` · ${zh ? '选中需' : 'Selected need'} ${quota.required}` : ''}`;
}

export function cabinProblemText(action: CabinAction, zh: boolean): string {
  return action.problem === 'full' ? zh ? '舱容不足' : 'Not enough cabin capacity'
    : action.problem === 'blocked' ? zh ? '舱门被堵住' : 'Cabin door blocked'
    : action.problem === 'unsupported' ? zh ? '这种单位无法入舱' : 'This unit cannot enter the cabin'
    : zh ? '舱室已失守或损坏' : 'The cabin is breached or damaged';
}
