import { boardUnit } from '../../shared/decks';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { carries } from '../../shared/naval';
import { bodyMass } from '../../shared/physical-body';
import { routeArrivals } from '../../shared/route-selection';
import { shipPassengers } from '../../shared/ship-geometry';
import { sameGround, walkableGoal } from '../../shared/terrain';
import { isTransportKind } from '../../shared/transport-role';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { navalServices } from '../policy/naval-services';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { passengerBoardingSafe } from './worker-boarding';

/** A real boarding order owns the worker while the ferry still sails to the loading coast. */
export function planSettlerBoarding(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, primary: readonly GameCommand[]): GameCommand[] {
  const own = snapshot.units.filter(unit => unit.owner === owner);
  const ferries = options.memory.naval?.ferries;
  if (!ferries) return [];
  const services = navalServices(snapshot, owner, options);
  const reserved = new Set([...services.reserved, ...Object.values(ferries).flatMap(mission => mission.crewIds),
    ...primary.flatMap(command => 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [])]);
  const commands: GameCommand[] = [];
  for (const boat of own.filter(unit => isTransportKind(unit.kind) && !services.reserved.has(unit.id))) {
    const mission = ferries[boat.id];
    if (!mission || mission.purpose !== 'settle' || mission.phase !== 'loading') continue;
    const shore = walkableGoal(snapshot.map, mission.from.x, mission.from.y);
    const cargo = shipPassengers(snapshot.units, boat);
    const cargoIds = new Set(cargo.map(unit => unit.id));
    const pending = own.filter(unit => !cargoIds.has(unit.id) && (unit.order.type === 'board' && unit.order.transportId === boat.id
      || mission.crewIds.includes(unit.id)));
    const settlers = [...cargo, ...pending].filter(unit => unit.kind === 'worker').length;
    const workers = own.filter(unit => unit.kind === 'worker' && !unit.deck && !reserved.has(unit.id)
      && (unit.order.type === 'idle' || unit.order.type === 'mine') && sameGround(snapshot.map, unit, shore)
      && options.memory.unitClaims[unit.id]?.kind !== 'build' && options.memory.unitClaims[unit.id]?.kind !== 'retreat');
    const reserveMiners = snapshot.resources.some(mine => mine.amount > 0 && sameGround(snapshot.map, mine, shore)
      && snapshot.buildings.some(hall => hall.owner === owner && hall.kind === 'townHall' && hall.complete
        && distance(hall, mine) < GOLD_MINE_RULES.baseRange)) ? 3 : 0;
    const wanted = Math.min(2 - settlers, workers.length - reserveMiners);
    if (wanted <= 0) continue;
    const planning = [...snapshot.units];
    for (const passenger of pending) { const copy = { ...passenger, deck: undefined }; if (boardUnit(boat, copy, planning)) planning.push(copy); }
    let room = carries(boat) - [...cargo, ...pending].reduce((mass, passenger) => mass + bodyMass(passenger), 0);
    const crew = routeArrivals(snapshot.map, workers, shore, 'land')
      .sort((a, b) => Number(b.unit.order.type === 'idle') - Number(a.unit.order.type === 'idle')).slice(0, wanted).flatMap(({ unit }) => {
      if (!passengerBoardingSafe(snapshot, owner, options, unit, boat)) return [];
      if (bodyMass(unit) > room) return [];
      const copy = { ...unit };
      if (!boardUnit(boat, copy, planning)) return [];
      planning.push(copy); reserved.add(unit.id); room -= bodyMass(unit); return [unit.id];
    });
    if (crew.length) commands.push({ type: 'board', unitIds: crew, transportId: boat.id });
  }
  return commands;
}
