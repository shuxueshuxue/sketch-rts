import { reviseAssaultBeaches, orderBootstrapAssaultLanding } from './assault-beach';
import { planShoreTransfers } from './shore-transfer';
import { unitMover } from '../../shared/catalog';
import { sameGround } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { cancelFerry, planNavalTacticsWithAssignments } from '../policy/naval';
import { units } from '../policy/snapshot';
import { mountedMinePlan } from '../policy/mounted-mine-plan';
import type { AiPolicyContext } from '../policy/types';
import { medicalRecoveryReleasedUnitIds, planMedicalRecoveryTasks } from './medical-recovery';
import { planSettlerBoarding } from './ferry-preparation';
import { planRiderCrossing, riderFerryCrew } from './rider-crossing';
import { transportNeedsRecovery, transportRecovery } from './transport-recovery';
import { postRecoveryCommands } from './front-recovery';
import { expeditionDeparture } from './expedition-departure';
import { landRecoveryAssignments, mainlandCareAssignments, patientRendezvousCommands } from './land-recovery';
import { continuingPatientRendezvous, rememberPatientRendezvous } from './medical-rendezvous';
import { planLandedCombat } from './landed-combat';
import { canPauseFerryForWorker, workerBoardingSafe } from './worker-boarding';
import { settlerSeaRoutes } from './settler-sea-route';
import { safeFerryReturn } from './safe-ferry-return';

function recoveryAssignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  const landed = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land'
    && unit.kind !== 'worker' && unit.order.type !== 'board' && home && !sameGround(snapshot.map, unit, home));
  const care = landRecoveryAssignments(snapshot, owner, options, landed);
  const assigned = new Set([...care.recovering.map(({ patient }) => patient.id), ...care.posts.map(({ patient }) => patient.id)]);
  return { ...care, continuing: continuingPatientRendezvous(snapshot, owner, landed, options)
    .filter(({ patient }) => !assigned.has(patient.id)) };
}

export function expeditionRecoveryUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const { recovering, continuing, unmedicated, posts } = recoveryAssignments(snapshot, owner, options);
  return new Set([...recovering.flatMap(({ patient, healer }) => [patient.id, healer.id]), ...unmedicated.map(({ patient }) => patient.id),
    ...continuing.map(({ patient }) => patient.id), ...posts.map(({ patient }) => patient.id), ...transportRecovery(snapshot, owner, options).ids]);
}

/** An expedition's naval ownership also owns its land recovery orders. */
export function planBootstrapNaval(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  reviseAssaultBeaches(snapshot, owner, options);
  const crossing = planRiderCrossing(snapshot, owner, options);
  const ferries = options.memory.naval?.ferries, cancelled: GameCommand[] = [];
  const released = new Set<string>();
  for (const worker of units(snapshot, owner)) {
    if (worker.kind !== 'worker' || worker.deck || worker.order.type !== 'board') continue;
    const transportId = worker.order.transportId;
    const boat = snapshot.units.find(unit => unit.id === transportId && unit.owner === owner);
    const mission = boat && ferries?.[boat.id];
    if (!boat || !mission || workerBoardingSafe(snapshot, owner, options, worker, boat)) continue;
    released.add(worker.id);
    mission.crewIds = mission.crewIds.filter(id => id !== worker.id);
    cancelled.push({ type: 'stop', unitIds: [worker.id] });
  }
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
  const { recovering, continuing, unmedicated, foes, posts } = recoveryAssignments(snapshot, owner, options);
  const pendingPatients = continuing.map(({ patient }) => patient.id);
  const medics = new Set(recovering.map(({ healer }) => healer.id));
  const departing = expeditionDeparture(snapshot, owner, options, ports.ids,
    new Set([...recovering.map(({ patient }) => patient.id), ...unmedicated.map(({ patient }) => patient.id),
      ...pendingPatients, ...posts.map(({ patient }) => patient.id), ...medics]));
  const reserved = new Set([...recovering.map(({ patient }) => patient.id), ...unmedicated.map(({ patient }) => patient.id),
    ...pendingPatients, ...posts.map(({ patient }) => patient.id), ...medics, ...ports.ids, ...departing.ids]);
  const mounted = new Set(options.memory.mounted?.flatMap(job => job.unitIds));
  const mainland = mainlandCareAssignments(snapshot, owner, options);
  // Recruitment must use the same care query as mobileCare before a new
  // boarding request can replace that patient's or necessary healer's job.
  const mainlandCare = new Set([...(mainland?.unmedicated ?? []).map(({ patient }) => patient.id),
    ...(mainland?.recovering ?? []).flatMap(({ patient, healer }) => [patient.id, healer.id])]);
  const commands = [...crossing, ...cancelled, ...planShoreTransfers(snapshot,owner,options), ...planNavalTacticsWithAssignments(snapshot, owner, options, {
    settlementEscort: 'when-defended',
    orderAssaultLanding: (boat, goal, ordinary) => orderBootstrapAssaultLanding(snapshot, owner, options, boat, goal, ordinary),
    orderCrew: (soldiers, shore, boat) => riderFerryCrew(snapshot, soldiers, shore, boat, options),
    mineEligible: mines.eligible, targetAvailable: mines.targetAvailable,
    transportReady: boat => !transportNeedsRecovery(snapshot, boat),
    troopAvailable: unit => !mounted.has(unit.id) && !reserved.has(unit.id) && !mainlandCare.has(unit.id),
    workerAvailable: (unit, boat) => !released.has(unit.id) && canPauseFerryForWorker(snapshot, owner, options, boat)
      && workerBoardingSafe(snapshot, owner, options, unit, boat),
  })];
  commands.push(...planSettlerBoarding(snapshot, owner, options, commands));

  // The same naval owner runs local combat; a new boarding/care/departure
  // assignment takes precedence over micro, including one made this think.
  const medical = medics.size ? planMedicalRecoveryTasks(snapshot, owner, recovering.map(({ patient }) => patient), options) : undefined;
  const healing = medical ? medical.commands.filter(command =>
    'unitId' in command ? medics.has(command.unitId) : 'unitIds' in command && command.unitIds.some(id => medics.has(id))) : [];
  const workingMedics = medical?.occupied ?? new Set<string>();
  const releasedMedics = new Set([...medicalRecoveryReleasedUnitIds(snapshot, owner, options),
    ...[...medics].filter(id => !workingMedics.has(id))]);
  // Keep every care/ferry/departure reservation for recruitment. Only local
  // backline execution may take over a healer without an actual medical task.
  const retreat = patientRendezvousCommands(snapshot, recovering, foes, medics);
  // A medic can also be a predicted patient; medics have no rendezvous
  // command of their own. Preserve actual patient moves, not that empty job.
  const patients = new Set([...retreat.flatMap(command => 'unitIds' in command ? command.unitIds : []), ...pendingPatients, ...unmedicated.map(({ patient }) => patient.id),
    ...posts.map(({ patient }) => patient.id), ...ports.ids, ...departing.ids]);
  const local = planLandedCombat(snapshot, owner, options, new Set([...reserved].filter(id => !releasedMedics.has(id) || patients.has(id))
    .concat([...mounted, ...commands.flatMap(command => command.type === 'board' ? command.unitIds : [])])), releasedMedics);
  const tactical = new Set(local.flatMap(command => 'unitIds' in command ? command.unitIds : []));

  const published: GameCommand[] = [...commands.flatMap((command): GameCommand[] => {
    if ('unitId' in command) return reserved.has(command.unitId) ? [] : [command];
    if (!('unitIds' in command)) return [command];
    const unitIds = command.unitIds.filter(id => !reserved.has(id) && !tactical.has(id));
    return unitIds.length ? [{ ...command, unitIds }] : [];
  }), ...local, ...postRecoveryCommands(posts), ...retreat, ...unmedicated.map(({ patient, cover }): GameCommand =>
    ({ type: 'move', unitIds: [patient.id], ...cover, avoidCombat: true })), ...healing,
    ...ports.commands.flatMap((command): GameCommand[] => {
      if (!('unitIds' in command)) return [command];
      const unitIds = command.unitIds.filter(id => !departing.ids.has(id));
      return unitIds.length ? [{ ...command, unitIds }] : [];
    }), ...departing.commands];
  rememberPatientRendezvous(options, recovering, retreat, published, continuing);
  return settlerSeaRoutes(snapshot, owner, options, safeFerryReturn(snapshot, owner, options, published).commands);
}
