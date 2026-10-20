import { UNIT_DEFS } from '../../../shared/catalog';
import { BOARDING_GAP } from '../../../shared/naval';
import { distanceToHull, shipPassengers } from '../../../shared/ship-geometry';
import { isTransportKind } from '../../../shared/transport-role';
import { sameGround } from '../../../shared/terrain';
import { convoyCanCarry } from '../../policy/convoy-load';
import { distance } from '../../policy/spatial';
import type { ExecutorFeedback, ExecutionState, JsonValue, StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, grantedUnits, validExecutorGrant } from '../executor-grants';
import { landIdAt } from '../regions';

function ids(value: JsonValue | undefined): readonly string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}
function isState(value: JsonValue | undefined): value is ExecutionState {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Native board/unload commands own rendezvous, deck packing and navigation.
 * Strategic departure, destination and manifest come only from the grant. */
function executeVoyage(input: Parameters<StrategyExecutor['execute']>[0]): ExecutorFeedback {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const { snapshot, execution, grant } = input, base = executorFeedback(input);
    const voyage = grant.voyages.find(voyage => voyage.action.actionId === execution.token.actionId
      && voyage.action.generation === execution.token.generation);
    if (!voyage) return blockedExecutor(input, 'no-granted-voyage');
    const shipAssignment = grant.assignments.find(assignment => assignment.id === voyage.shipAssignmentId);
    const granted = grantedUnits(input), allowed = new Set(granted.map(unit => unit.id));
    const boat = granted.find(unit => unit.id === shipAssignment?.unitId && isTransportKind(unit.kind));
    if (!boat) return blockedExecutor(input, 'assigned-transport-no-longer-present');
    const assignments = grant.assignments.filter(assignment => voyage.crewAssignmentIds.includes(assignment.id));
    const crew = assignments.flatMap(assignment => granted.filter(unit => unit.id === assignment.unitId));
    if (!crew.length) return blockedExecutor(input, 'no-granted-passengers');
    if (crew.length !== assignments.length) return blockedExecutor(input, 'assigned-passenger-no-longer-present');
    const cargo = shipPassengers(snapshot.units, boat);
    if (cargo.some(unit => !allowed.has(unit.id))) return blockedExecutor(input, 'ungranted-passenger-on-transport', cargo.filter(unit => !allowed.has(unit.id)).map(unit => unit.id));
    const unexpected = snapshot.units.filter(unit => unit.order.type === 'board' && unit.order.transportId === boat.id && !allowed.has(unit.id));
    if (unexpected.length) return blockedExecutor(input, 'ungranted-boarders-on-transport', unexpected.map(unit => unit.id));
    const ground = voyage.landingGround.point;
    const departure = voyage.departureGround.point;
    const targetLand = voyage.destination.landId ?? input.objective.target.landId ?? landIdAt(snapshot.map, execution.target.point);
    if (!targetLand || landIdAt(snapshot.map, ground) !== targetLand
      || landIdAt(snapshot.map, ground) !== voyage.landingGround.landId
      || landIdAt(snapshot.map, departure) !== voyage.departureGround.landId)
      return blockedExecutor(input, 'voyage-landing-land-unverified');
    const returning = voyage.decision === 'return' || voyage.phase === 'return';
    const destination = returning ? voyage.departure : voyage.destination, landing = returning ? departure : ground;
    const landed = crew.filter(unit => !unit.deck && !unit.cabin && sameGround(snapshot.map, unit, landing));
    const cargoIds = new Set(cargo.map(unit => unit.id));
    const loaded = crew.filter(unit => cargoIds.has(unit.id));
    const previouslyLoaded = ids(execution.state.loadedIds), previouslyLanded = ids(execution.state.landedIds);
    const newLoaded = loaded.filter(unit => !previouslyLoaded.includes(unit.id));
    const newLanded = landed.filter(unit => previouslyLoaded.includes(unit.id) && !previouslyLanded.includes(unit.id));
    const progress: ExecutorFeedback['progress'][number][] = [
      ...(newLoaded.length ? [{ kind: 'loaded' as const, unitIds: newLoaded.map(unit => unit.id), entityIds: [boat.id], basis: 'observed-world' as const }] : []),
      ...(newLanded.length ? [{ kind: 'unloaded' as const, unitIds: newLanded.map(unit => unit.id), entityIds: [boat.id], basis: 'observed-world' as const }] : []),
    ];
    const state = { ...execution.state,
      loadedIds: [...new Set([...previouslyLoaded, ...loaded.map(unit => unit.id)])],
      landedIds: [...new Set([...previouslyLanded, ...newLanded.map(unit => unit.id)])] };
    if (landed.length === crew.length)
      return { ...base, status: returning ? 'abandoned' : 'complete', phase: returning ? 'returned' : 'delivered', state, progress };
    const commands: ExecutorFeedback['commands'][number][] = [];
    if (returning || loaded.length + landed.length === crew.length) {
      const origin = execution.state.departurePose;
      const started = origin && typeof origin === 'object' && 'x' in origin && 'y' in origin
        && typeof origin.x === 'number' && typeof origin.y === 'number' ? { x: origin.x, y: origin.y } : undefined;
      const sailing = started && distance(boat, started) > 32;
      if (sailing && execution.state.sailingObserved !== true) progress.push({ kind: 'sailed', unitIds: loaded.map(unit => unit.id), entityIds: [boat.id], basis: 'observed-world' });
      for (const unit of loaded) if (unit.order.type !== 'hold' && unit.order.type !== 'cast')
        commands.push({ command: { type: 'holdPosition', unitIds: [unit.id] }, purpose: 'task' });
      if (boat.order.type !== 'unload' || distance(boat.order, destination.point) >= 80)
        commands.push({ command: { type: 'unload', unitIds: [boat.id], ...destination.point, ...(returning ? { avoidCombat: true } : {}) },
          purpose: returning ? 'life-saving' : 'task' });
      return { ...base, status: 'active', phase: returning ? 'returning' : sailing ? 'sailing' : 'departing', commands, progress,
        state: { ...state, departurePose: started ?? { x: boat.x, y: boat.y }, sailingObserved: execution.state.sailingObserved === true || !!sailing } };
    }
    if (voyage.decision === 'stop-loading') return { ...blockedExecutor(input, 'voyage-loading-preempted', crew.map(unit => unit.id)), state, progress };
    const waiting = crew.filter(unit => !cargoIds.has(unit.id) && !landed.includes(unit));
    if (assignments.some(assignment => waiting.some(unit => unit.id === assignment.unitId) && assignment.interruption))
      return { ...blockedExecutor(input, 'passenger-in-life-saving-interruption', waiting.map(unit => unit.id)), state, progress };
    if (!convoyCanCarry(snapshot, [boat], [...loaded, ...waiting])) return { ...blockedExecutor(input, 'assigned-manifest-does-not-fit-deck', waiting.map(unit => unit.id)), state, progress };
    const wrongGround = waiting.filter(unit => unit.deck || unit.cabin || !sameGround(snapshot.map, unit, departure));
    if (wrongGround.length) return { ...blockedExecutor(input, 'passengers-not-on-departure-land', wrongGround.map(unit => unit.id)), state, progress };
    for (const unit of waiting) if (unit.order.type !== 'cast' && !(unit.order.type === 'board' && unit.order.transportId === boat.id))
      commands.push({ command: { type: 'board', unitIds: [unit.id], transportId: boat.id }, purpose: 'task' });
    if (distanceToHull(boat, departure) > UNIT_DEFS.worker.radius + BOARDING_GAP
      && !(boat.order.type === 'move' && distance(boat.order, voyage.departure.point) < 40))
      commands.push({ command: { type: 'move', unitIds: [boat.id], ...voyage.departure.point, avoidCombat: true }, purpose: 'task' });
    else if (distanceToHull(boat, departure) <= UNIT_DEFS.worker.radius + BOARDING_GAP
      && boat.order.type !== 'idle' && boat.order.type !== 'hold')
      commands.push({ command: { type: 'stop', unitIds: [boat.id] }, purpose: 'task' });
    return { ...base, status: 'active', phase: 'loading', state, commands, progress };
}

export const transportExecutor: StrategyExecutor = {
  id: 'strategy.transport',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    if (!input.grant.voyages.length) return blockedExecutor(input, 'no-granted-voyage');
    const previous = input.execution.state.voyages;
    const previousStates = isState(previous) ? previous : {};
    const seen = new Set<string>();
    for (const voyage of input.grant.voyages) for (const assignment of input.grant.assignments
      .filter(assignment => assignment.id === voyage.shipAssignmentId || voyage.crewAssignmentIds.includes(assignment.id))) {
      if (seen.has(assignment.unitId)) return blockedExecutor(input, 'duplicate-unit-in-parallel-voyages', [assignment.unitId]);
      seen.add(assignment.unitId);
    }
    const results = input.grant.voyages.map(voyage => {
      const assignmentIds = new Set([voyage.shipAssignmentId, ...voyage.crewAssignmentIds]);
      const assignments = input.grant.assignments.filter(assignment => assignmentIds.has(assignment.id));
      const unitIds = new Set(assignments.map(assignment => assignment.unitId));
      const stored = voyage.id in previousStates ? previousStates[voyage.id] : undefined;
      const state = isState(stored) ? stored : {};
      const phase = 'phase' in state && typeof state.phase === 'string' ? state.phase : input.execution.phase;
      return { voyage, feedback: executeVoyage({ ...input, execution: { ...input.execution, state, phase },
        grant: { ...input.grant, voyages: [voyage], assignments,
          leases: input.grant.leases.filter(lease => lease.resourceKey.startsWith('unit:') && unitIds.has(lease.resourceKey.slice(5))) } }) };
    });
    const required = Array.isArray(input.execution.state.requiredVoyageIds) ? ids(input.execution.state.requiredVoyageIds)
      : input.grant.voyages.map(voyage => voyage.id);
    const states: Record<string, JsonValue> = Object.fromEntries(results.map(({ voyage, feedback }) => [voyage.id,
      { ...feedback.state, phase: feedback.phase, status: feedback.status }]));
    for (const id of required) {
      const stored = previousStates[id];
      if (!(id in states) && stored !== undefined) states[id] = stored;
    }
    const requiredStatuses = required.map(id => {
      const state = states[id];
      return state && typeof state === 'object' && 'status' in state ? state.status : undefined;
    });
    const missing = requiredStatuses.some(status => status === undefined);
    const blocked = missing || results.some(result => result.feedback.status === 'blocked');
    const complete = requiredStatuses.every(status => status === 'complete');
    const abandoned = requiredStatuses.length > 0 && requiredStatuses.every(status => status === 'complete' || status === 'abandoned') && !complete;
    const base = executorFeedback(input);
    return { ...base, status: complete ? 'complete' : abandoned ? 'abandoned' : blocked ? 'blocked' : 'active',
      phase: complete ? 'delivered' : abandoned ? 'returned' : 'parallel-voyages',
      state: { ...input.execution.state, voyages: states, requiredVoyageIds: [...required],
        pendingVoyageIds: results.filter(result => !['complete', 'abandoned', 'failed'].includes(result.feedback.status)).map(result => result.voyage.id) },
      commands: results.flatMap(result => result.feedback.commands), progress: results.flatMap(result => result.feedback.progress),
      reasons: [...results.flatMap(result => result.feedback.reasons),
        ...(missing ? blockedExecutor(input, 'required-voyage-not-granted').reasons : [])] };
  },
};
