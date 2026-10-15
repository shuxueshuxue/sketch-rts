import { planShoreTransfers } from './shore-transfer';
import { unitMover } from '../../shared/catalog';
import { sameGround } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { cancelFerry, planNavalTacticsWithAssignments } from '../policy/naval';
import { units } from '../policy/snapshot';
import { mountedMinePlan } from '../policy/mounted-mine-plan';
import type { AiPolicyContext } from '../policy/types';
import { planMedicalRecovery } from './medical-recovery';
import { planSettlerBoarding } from './ferry-preparation';
import { planRiderCrossing, riderFerryCrew } from './rider-crossing';
import { transportNeedsRecovery, transportRecovery } from './transport-recovery';
import { postRecoveryCommands } from './front-recovery';
import { expeditionDeparture } from './expedition-departure';
import { landRecoveryAssignments, mainlandCareAssignments, patientRendezvousCommands } from './land-recovery';

function recoveryAssignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  const landed = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land'
    && unit.kind !== 'worker' && unit.order.type !== 'board' && home && !sameGround(snapshot.map, unit, home));
  return landRecoveryAssignments(snapshot, owner, options, landed);
}

export function expeditionRecoveryUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const { recovering, unmedicated, posts } = recoveryAssignments(snapshot, owner, options);
  return new Set([...recovering.flatMap(({ patient, healer }) => [patient.id, healer.id]), ...unmedicated.map(({ patient }) => patient.id),
    ...posts.map(({ patient }) => patient.id), ...transportRecovery(snapshot, owner, options).ids]);
}

/** An expedition's naval ownership also owns its land recovery orders. */
export function planBootstrapNaval(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const crossing = planRiderCrossing(snapshot, owner, options);
  const ferries = options.memory.naval?.ferries, cancelled: GameCommand[] = [];
  if (ferries) for (const boat of units(snapshot, owner)) {
    const mission = ferries[boat.id];
    if (mission?.purpose === 'rebase' && mission.phase !== 'return'
      && snapshot.resources.some(mine => mine.id === mission.targetId && mine.amount === 0)) {
      // The ordinary ferry return owns the hull; cancellation releases its pending boarders.
      cancelled.push(...cancelFerry(snapshot, boat, mission, options).filter(command => command.type === 'stop'));
    }
  }
  const mines = mountedMinePlan(snapshot, options.memory);
  const ports = transportRecovery(snapshot, owner, options);
  const { recovering, unmedicated, foes, posts } = recoveryAssignments(snapshot, owner, options);
  const medics = new Set(recovering.map(({ healer }) => healer.id));
  const departing = expeditionDeparture(snapshot, owner, options, ports.ids,
    new Set([...recovering.map(({ patient }) => patient.id), ...unmedicated.map(({ patient }) => patient.id),
      ...posts.map(({ patient }) => patient.id), ...medics]));
  const reserved = new Set([...recovering.map(({ patient }) => patient.id), ...unmedicated.map(({ patient }) => patient.id),
    ...posts.map(({ patient }) => patient.id), ...medics, ...ports.ids, ...departing.ids]);
  const mounted = new Set(options.memory.mounted?.flatMap(job => job.unitIds));
  const mainland = mainlandCareAssignments(snapshot, owner, options);
  // Recruitment must use the same care query as mobileCare before a new
  // boarding request can replace that patient's or necessary healer's job.
  const mainlandCare = new Set([...(mainland?.unmedicated ?? []).map(({ patient }) => patient.id),
    ...(mainland?.recovering ?? []).flatMap(({ patient, healer }) => [patient.id, healer.id])]);
  const commands = [...crossing, ...cancelled, ...planShoreTransfers(snapshot,owner,options), ...planNavalTacticsWithAssignments(snapshot, owner, options, {
    orderCrew: (soldiers, shore, boat) => riderFerryCrew(snapshot, soldiers, shore, boat, options),
    mineEligible: mines.eligible, targetAvailable: mines.targetAvailable,
    transportReady: boat => !transportNeedsRecovery(snapshot, boat),
    troopAvailable: unit => !mounted.has(unit.id) && !reserved.has(unit.id) && !mainlandCare.has(unit.id),
  })];
  commands.push(...planSettlerBoarding(snapshot, owner, options, commands));

  const healing = medics.size ? planMedicalRecovery(snapshot, owner, recovering.map(({ patient }) => patient)).filter(command =>
    'unitId' in command ? medics.has(command.unitId) : 'unitIds' in command && command.unitIds.some(id => medics.has(id))) : [];
  const retreat = patientRendezvousCommands(snapshot, recovering, foes, medics);
  return [...commands.flatMap((command): GameCommand[] => {
    if ('unitId' in command) return reserved.has(command.unitId) ? [] : [command];
    if (!('unitIds' in command)) return [command];
    const unitIds = command.unitIds.filter(id => !reserved.has(id));
    return unitIds.length ? [{ ...command, unitIds }] : [];
  }), ...postRecoveryCommands(posts), ...retreat, ...unmedicated.map(({ patient, cover }): GameCommand =>
    ({ type: 'move', unitIds: [patient.id], ...cover, avoidCombat: true })), ...healing,
    ...ports.commands.flatMap((command): GameCommand[] => {
      if (!('unitIds' in command)) return [command];
      const unitIds = command.unitIds.filter(id => !departing.ids.has(id));
      return unitIds.length ? [{ ...command, unitIds }] : [];
    }), ...departing.commands];
}
