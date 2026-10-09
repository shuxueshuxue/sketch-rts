import { cabinAvailable, cabinExitPoint, canEnterCabin, isCabinCrew, isInCabin, shipCabinCapacity } from '../shared/ship-cabin';
import { canEquip } from '../shared/equipment';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../shared/types';

type CabinSnapshot = Pick<GameSnapshot, 'units' | 'teams' | 'variants'>;
export type CabinAction = { type: 'enterCabin' | 'leaveCabin'; unitIds: string[]; enabled: boolean; problem?: 'full' | 'unavailable' | 'unsupported' | 'blocked' };

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
  const allowed = aboard.filter(unit => canEnterCabin(snapshot, unit));
  if (allowed.length) return { type: 'enterCabin', unitIds: allowed.map(unit => unit.id), enabled: true };
  const available = aboard.some(unit => {
    const ship = snapshot.units.find(ship => ship.id === unit.deck!.shipId)!;
    return cabinAvailable(snapshot, ship);
  });
  const full = aboard.some(unit => {
    const ship = snapshot.units.find(ship => ship.id === unit.deck!.shipId)!;
    return snapshot.units.filter(crew => crew.hp > 0 && crew.deck?.shipId === ship.id && isInCabin(crew)).length >= shipCabinCapacity(ship);
  });
  const canFit=aboard.some(unit=>isCabinCrew(snapshot,unit));
  return { type: 'enterCabin', unitIds: aboard.map(unit => unit.id), enabled: false, problem: !available ? 'unavailable' : full ? 'full' : canFit ? 'blocked' : 'unsupported' };
}

export function cabinCommand(action: CabinAction | undefined): GameCommand | undefined {
  return action?.enabled ? { type: action.type, unitIds: action.unitIds } : undefined;
}

export function cabinStatus(unit: Unit, zh: boolean) {
  return isInCabin(unit) ? unit.cabin?.breached ? zh ? '舱室失守 · 等待出舱' : 'Cabin breached · Waiting to exit' : zh ? '舱内' : 'In cabin' : '';
}
