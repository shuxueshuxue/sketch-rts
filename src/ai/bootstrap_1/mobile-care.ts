import { unitMover } from '../../shared/catalog';
import { sameGround } from '../../shared/terrain';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import { navalUnitIds } from '../policy/naval';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { landRecoveryAssignments, patientRendezvousCommands } from './expedition-recovery';

function assignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  if (!home) return [];
  const own = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land'
    && unit.kind !== 'worker' && unit.order.type !== 'board' && sameGround(snapshot.map, unit, home));
  if (!own.some(unit => unit.expiresTick === undefined && unit.hp < unit.maxHp)) return [];
  const reserved = navalUnitIds(snapshot, owner, options, () => false);
  const care = landRecoveryAssignments(snapshot, owner, options, own.filter(unit => !reserved.has(unit.id)));
  const medics = new Set(care.recovering.map(({ healer }) => healer.id));
  return care.recovering.filter(({ patient }) => !medics.has(patient.id)
    && !options.memory.v6?.creep?.group.includes(patient.id))
    .map(pair => ({ ...pair, foes: care.foes, medics }));
}

/** Home-ground patients rendezvous with an existing medic while expeditions and camps keep their own care. */
export const mobileCare: AiScript = {
  id: 'mobileCare', phase: 'tactics',
  claimsUnits: (snapshot, owner, options) => new Set(assignments(snapshot, owner, options).map(({ patient }) => patient.id)),
  run: (snapshot, owner, options) => assignments(snapshot, owner, options)
    .flatMap(({ patient, healer, foes, medics }) => patientRendezvousCommands(snapshot, [{ patient, healer }], foes, medics)),
};
