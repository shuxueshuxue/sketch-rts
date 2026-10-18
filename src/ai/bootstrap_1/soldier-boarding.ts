import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { passengerBoardingSafe } from './worker-boarding';

/** A soldier cannot fight while walking to a berth. Apply the same native
 * road/weapon check used for engineers before reserving that trip. */
export function safeSoldierBoarding(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, planned: GameCommand[]) {
  const denied = new Set<string>();
  const safe = (id: string, boatId: string) => {
    const unit = snapshot.units.find(unit => unit.id === id);
    const boat = snapshot.units.find(unit => unit.id === boatId);
    if (!unit || !boat || unit.owner !== owner || unit.kind === 'worker' || unit.deck || unit.cabin) return true;
    const allowed = passengerBoardingSafe(snapshot, owner, options, unit, boat);
    if (!allowed) denied.add(id);
    return allowed;
  };
  const commands = planned.flatMap((command): GameCommand[] => {
    if (command.type !== 'board') return [command];
    const unitIds = command.unitIds.filter(id => safe(id, command.transportId));
    return unitIds.length === command.unitIds.length ? [command] : unitIds.length ? [{ ...command, unitIds }] : [];
  });
  for (const unit of snapshot.units) {
    if (unit.owner !== owner || unit.order.type !== 'board' || safe(unit.id, unit.order.transportId)) continue;
    // Recovery may already be moving the exposed passenger away.
    if (!commands.some(command => command.type === 'move' && command.unitIds.includes(unit.id)))
      commands.push({ type: 'stop', unitIds: [unit.id] });
  }
  for (const mission of Object.values(options.memory.naval?.ferries ?? {}))
    mission.crewIds = mission.crewIds.filter(id => !denied.has(id));
  return commands;
}
