import { unitMover } from '../../shared/catalog';
import { shipPassengers } from '../../shared/ship-geometry';
import { isTransportKind } from '../../shared/transport-role';
import { isOpenGround, sameGround } from '../../shared/terrain';
import type { Unit } from '../../shared/types';
import { convoyCanCarry } from '../policy/convoy-load';
import { distance } from '../policy/spatial';
import { MINING_RALLY_RADIUS } from '../bootstrap_1/mining-rally';
import { MINING_PURSUIT_RADIUS } from '../bootstrap_1/mining-leash';
import { currentAllocationLandRouteReader } from './allocation-arrival-query';
import type { ExecutorFeedback, ExecutorInput, StrategyExecutor } from './allocation-types';
import { blockedExecutor, executorFeedback, sameAction } from './executor-grants';
import { goalActionIntent, goalEntityId, goalEntityIds, goalGrantedCohort, goalHasLease, goalPoint, goalRecord, goalTarget } from './goal-executor-parameters';
import { goalCampMemberIds, resolveGoalCamp, goalFact } from './goal-facts';
import type { GoalActionKind } from './goal-planner-types';
import { landIdAt } from './regions';
import { strategyIsOpponent } from './ownership';
import { assembleExecutor } from './executors/assemble';
import { clearCampExecutor } from './executors/clear-camp';
import { evacuateExecutor } from './executors/evacuate';

const ids = (value: unknown): readonly string[] | null => Array.isArray(value) && value.every(id => typeof id === 'string' && id.length > 0)
  ? [...new Set(value as string[])].sort() : null;
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const busy = (unit: Unit) => unit.order.type === 'cast' || unit.order.type === 'charge';
function restricted(input: ExecutorInput, unitIds: readonly string[]): ExecutorInput {
  return { ...input, grant: { ...input.grant,
    leases: input.grant.leases.filter(lease => !lease.resourceKey.startsWith('unit:') || unitIds.includes(lease.resourceKey.slice(5))),
    assignments: input.grant.assignments.filter(assignment => unitIds.includes(assignment.unitId)) } };
}
function landPort(input: ExecutorInput) { return currentAllocationLandRouteReader() ?? null; }
function active(input: ExecutorInput, phase: string, commands: ExecutorFeedback['commands'], state = input.execution.state): ExecutorFeedback {
  return { ...executorFeedback(input), status: 'active', phase, commands, state };
}
function assemble(input: ExecutorInput, parameters: Readonly<Record<string, unknown>>): ExecutorFeedback {
  const cohort = goalEntityIds(parameters.cohort), at = goalTarget(parameters.at);
  if (!cohort?.length || !at || !landPort(input)) return blockedExecutor(input, 'goal-assembly-binding-or-route-port-pending');
  const grant = goalGrantedCohort(input, cohort);
  if (grant.missingIds.length) return blockedExecutor(input, 'goal-cohort-not-granted', [...grant.missingIds]);
  return assembleExecutor.execute({ ...restricted(input, cohort), execution: { ...input.execution, target: at, intent: { kind: 'borrow-force' } } });
}
function clearing(input: ExecutorInput, parameters: Readonly<Record<string, unknown>>, shore: boolean): ExecutorFeedback {
  const cohort = goalEntityIds(parameters.cohort), at = goalTarget(parameters.at), memberIds = ids(parameters.memberIds);
  if (!cohort?.length || !at || !memberIds || !landPort(input)) return blockedExecutor(input, 'goal-clearing-binding-or-route-port-pending');
  const grant = goalGrantedCohort(input, cohort);
  if (grant.missingIds.length) return blockedExecutor(input, 'goal-cohort-not-granted', [...grant.missingIds]);
  if (!isOpenGround(input.snapshot.map, at.point.x, at.point.y)) return blockedExecutor(input, 'goal-clearing-staging-pending');
  let target = at;
  if (!shore) {
    const original = typeof parameters.campId === 'string' ? goalCampMemberIds(parameters.campId) : null;
    if (!original || JSON.stringify(original) !== JSON.stringify(memberIds)) return blockedExecutor(input, 'goal-camp-binding-invalid');
    const camp = resolveGoalCamp(input.snapshot, parameters.campId as string);
    if (camp.status === 'invalid') return blockedExecutor(input, 'goal-camp-binding-invalid');
    if (camp.status === 'present') target = { ...at, point: camp.exposure.camp.center };
    // Absence at the first invocation cannot manufacture an observed kill.
    if (camp.status === 'cleared' && input.execution.state.goalCampObserved !== true
      && !input.snapshot.units.some(unit => memberIds.includes(unit.id) && unit.owner === 'neutral'))
      return blockedExecutor(input, 'goal-camp-lifecycle-pending');
  } else {
    const threats = ids(parameters.threatIds);
    if (!threats?.length || threats.some(id => input.snapshot.units.some(unit => unit.id === id && unit.hp > 0
      && unit.owner !== 'neutral' && !strategyIsOpponent(input.snapshot, input.owner, unit.owner))))
      return blockedExecutor(input, 'goal-shore-threat-binding-invalid');
  }
  const read = landPort(input)!;
  const roads = [...grant.units.map(unit => read(unit, at.point)), read(at.point, target.point)];
  if (roads.some(road => road.status !== 'known')) return blockedExecutor(input,
    roads.some(road => road.status === 'unknown') ? 'goal-clearing-route-pending' : 'goal-clearing-route-unreachable');
  return clearCampExecutor.execute({ ...restricted(input, cohort), execution: { ...input.execution, target,
    intent: { kind: 'clear-camp', memberIds }, state: { ...input.execution.state, goalCampObserved: true,
      staging: { ...at.point }, refuge: { ...at.point } } } });
}
function defend(input: ExecutorInput, parameters: Readonly<Record<string, unknown>>): ExecutorFeedback {
  const cohort = goalEntityIds(parameters.cohort), at = goalTarget(parameters.at), through = parameters.throughTick;
  const read = landPort(input);
  if (!cohort?.length || !at || !number(through) || !read) return blockedExecutor(input, 'goal-defense-binding-or-route-port-pending');
  const granted = goalGrantedCohort(input, cohort);
  if (granted.missingIds.length) return blockedExecutor(input, 'goal-cohort-not-granted', [...granted.missingIds]);
  const units = granted.units.filter(unit => unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && !unit.deck && !unit.cabin);
  if (units.length !== cohort.length) return blockedExecutor(input, 'goal-defenders-not-on-land');
  const horizon = parameters.protectionWindowTicks;
  if (typeof horizon === 'number') {
    if (!Number.isFinite(horizon) || horizon <= 0) return blockedExecutor(input, 'goal-defense-protection-window-invalid');
    const protectedSite = goalTarget(parameters.protectedSite) ?? at;
    const fact = goalFact({ kind: 'site-safe', site: protectedSite,
      throughTick: Math.max(input.snapshot.tick, Math.min(through, input.snapshot.tick + horizon)) });
    const observed = input.goalFacts?.(fact);
    if (!observed || observed.fact.id !== fact.id || observed.observedTick !== input.snapshot.tick
      || observed.state !== 'met' || (observed.availableTick ?? input.snapshot.tick) > input.snapshot.tick)
      return blockedExecutor(input, observed?.state === 'unmet' ? 'goal-defense-protection-unmet' : 'goal-defense-protection-pending');
  }
  const routeRows = units.map(unit => ({ unit, route: read(unit, at.point) }));
  const pending = routeRows.filter(row => row.route.status === 'unknown'), unreachable = routeRows.filter(row => row.route.status === 'unreachable');
  if (pending.length || unreachable.length) return blockedExecutor(input, pending.length ? 'goal-defense-route-pending' : 'goal-defense-route-unreachable',
    [...pending, ...unreachable].map(row => row.unit.id));
  const arrived = units.filter(unit => distance(unit, at.point) <= MINING_RALLY_RADIUS);
  const foes = input.snapshot.units.filter(unit => unit.hp > 0 && !unit.deck && !unit.cabin && unitMover(unit.kind) === 'land'
    && strategyIsOpponent(input.snapshot, input.owner, unit.owner) && sameGround(input.snapshot.map, unit, at.point)
    && distance(unit, at.point) <= MINING_PURSUIT_RADIUS);
  const commands: ExecutorFeedback['commands'][number][] = [];
  for (const unit of units) {
    if (busy(unit)) continue;
    if (!arrived.includes(unit)) {
      if (!(unit.order.type === 'move' && distance(unit.order, at.point) < 40))
        commands.push({ command: { type: 'move', unitIds: [unit.id], ...at.point, avoidCombat: true }, purpose: 'task' });
      continue;
    }
    const target = unit.attackDamage > 0 ? foes.slice().sort((a, b) => distance(unit, a) - distance(unit, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0] : undefined;
    if (target) {
      if (!(unit.order.type === 'attack' && unit.order.targetId === target.id))
        commands.push({ command: { type: 'attack', unitIds: [unit.id], targetId: target.id }, purpose: 'task' });
    } else if (unit.order.type !== 'hold') commands.push({ command: { type: 'holdPosition', unitIds: [unit.id] }, purpose: 'task' });
  }
  if (input.snapshot.tick > through && input.execution.state.goalArrivalTick === undefined)
    return { ...executorFeedback(input), status: 'failed', phase: 'guard-window-missed',
      reasons: [{ executor: input.execution.executor, outcome: 'abandoned', reason: 'goal-defense-arrived-after-window' }] };
  const complete = input.snapshot.tick >= through && arrived.length === cohort.length;
  const first = arrived.length === cohort.length && input.execution.state.goalArrivalTick === undefined;
  return { ...active(input, complete ? 'guard-window-observed' : arrived.length === cohort.length ? 'guarding' : 'returning', complete ? [] : commands,
    { ...input.execution.state, ...(first ? { goalArrivalTick: input.snapshot.tick } : {}) }), status: complete ? 'complete' : 'active',
    progress: first ? [{ kind: 'garrison-arrived', unitIds: arrived.map(unit => unit.id), entityIds: at.entityId ? [at.entityId] : [], basis: 'observed-world' }] : [] };
}
function evacuate(input: ExecutorInput, parameters: Readonly<Record<string, unknown>>): ExecutorFeedback {
  const unitIds = ids(parameters.unitIds), at = goalTarget(parameters.at);
  if (!unitIds?.length || !at || !landPort(input)) return blockedExecutor(input, 'goal-evacuation-binding-or-route-port-pending');
  const granted = goalGrantedCohort(input, unitIds);
  if (granted.missingIds.length) return blockedExecutor(input, 'goal-cohort-not-granted', [...granted.missingIds]);
  return evacuateExecutor.execute({ ...restricted(input, unitIds), objective: { ...input.objective, kind: 'Evacuate' },
    execution: { ...input.execution, target: at, intent: { kind: 'evacuate' } } });
}
function hullGrant(input: ExecutorInput, parameters: Readonly<Record<string, unknown>>) {
  const id = goalEntityId(parameters.transport), explicit = ids(parameters.dependentUnitIds);
  if (!id || !explicit) return null;
  const granted = goalGrantedCohort(input, [id, ...explicit]);
  const hull = granted.units.find(unit => unit.id === id && isTransportKind(unit.kind));
  if (!hull || granted.missingIds.length) return null;
  const cargo = shipPassengers(input.snapshot.units, hull);
  if (cargo.some(unit => unit.owner !== input.owner || !goalHasLease(input, `unit:${unit.id}`)
    || !explicit.includes(unit.id) && !goalEntityIds(parameters.cohort)?.includes(unit.id))) return null;
  if (input.snapshot.units.some(unit => unit.order.type === 'board' && unit.order.transportId === id
    && (!goalHasLease(input, `unit:${unit.id}`) || !goalEntityIds(parameters.cohort)?.includes(unit.id)))) return null;
  return { hull, cargo, dependencies: explicit };
}
function position(input: ExecutorInput, parameters: Readonly<Record<string, unknown>>): ExecutorFeedback {
  const boat = hullGrant(input, parameters), at = goalTarget(parameters.at), tolerance = parameters.tolerance;
  if (!boat || !at?.seaId || !number(tolerance) || tolerance < 0) return blockedExecutor(input, 'goal-transport-binding-not-granted');
  const base = executorFeedback(input), arrived = distance(boat.hull, at.point) <= tolerance;
  if (arrived) return { ...base, status: 'complete', phase: 'hull-at-planned-water' };
  if (busy(boat.hull)) return blockedExecutor(input, 'goal-transport-in-native-action');
  const moving = boat.hull.order.type === 'move' && distance(boat.hull.order, at.point) < 1e-6;
  return active(input, 'positioning', moving ? [] : [{ command: { type: 'move', unitIds: [boat.hull.id], ...at.point, avoidCombat: true }, purpose: 'task' }]);
}
function transport(input: ExecutorInput, parameters: Readonly<Record<string, unknown>>): ExecutorFeedback {
  const selected = goalEntityIds(parameters.cohort), boat = hullGrant(input, parameters), departure = goalRecord(parameters.departure), landing = goalRecord(parameters.landing);
  const water = goalPoint(departure?.water), ground = goalPoint(departure?.ground), destination = goalPoint(landing?.water), landedAt = goalPoint(landing?.ground);
  const at = goalTarget(parameters.at), tolerance = parameters.berthTolerance, origin = parameters.origin;
  if (!boat || !selected?.length || !water || !destination || !landedAt || !at?.landId || !number(tolerance) || tolerance < 0
    || origin !== 'land' && origin !== 'aboard' || origin === 'land' && !ground)
    return blockedExecutor(input, 'goal-transport-physical-binding-invalid');
  const granted = goalGrantedCohort(input, selected);
  if (granted.missingIds.length) return blockedExecutor(input, 'goal-cohort-not-granted', [...granted.missingIds]);
  if (landIdAt(input.snapshot.map, landedAt) !== at.landId) return blockedExecutor(input, 'goal-transport-landing-unverified');
  const loaded = granted.units.filter(unit => boat.cargo.some(passenger => passenger.id === unit.id));
  const landed = granted.units.filter(unit => !unit.deck && !unit.cabin && sameGround(input.snapshot.map, unit, landedAt));
  const waiting = granted.units.filter(unit => !loaded.includes(unit) && !landed.includes(unit));
  if (waiting.some(unit => unit.deck || unit.cabin)) return blockedExecutor(input, 'goal-passenger-on-different-transport');
  const previousLoaded = ids(input.execution.state.goalLoadedIds) ?? [], previousLanded = ids(input.execution.state.goalLandedIds) ?? [];
  const newlyLoaded = loaded.filter(unit => !previousLoaded.includes(unit.id)), newlyLanded = landed.filter(unit => previousLoaded.includes(unit.id) && !previousLanded.includes(unit.id));
  const progress: ExecutorFeedback['progress'][number][] = [
    ...(newlyLoaded.length ? [{ kind: 'loaded' as const, unitIds: newlyLoaded.map(unit => unit.id), entityIds: [boat.hull.id], basis: 'observed-world' as const }] : []),
    ...(newlyLanded.length ? [{ kind: 'unloaded' as const, unitIds: newlyLanded.map(unit => unit.id), entityIds: [boat.hull.id], basis: 'observed-world' as const }] : [])];
  const state = { ...input.execution.state, goalLoadedIds: [...new Set([...previousLoaded, ...loaded.map(unit => unit.id)])].sort(),
    goalLandedIds: [...new Set([...previousLanded, ...landed.map(unit => unit.id)])].sort() };
  if (landed.length === selected.length && !boat.cargo.length) return { ...executorFeedback(input), state, progress, status: 'complete', phase: 'delivered' };
  const commands: ExecutorFeedback['commands'][number][] = [];
  if (busy(boat.hull)) return blockedExecutor(input, 'goal-transport-in-native-action');
  if (waiting.length) {
    if (origin === 'aboard' || !ground || waiting.some(unit => !sameGround(input.snapshot.map, unit, ground)))
      return blockedExecutor(input, 'goal-passengers-not-on-departure-land');
    const error = distance(boat.hull, water), ready = error <= Math.min(tolerance, boat.hull.radius);
    if (!ready && input.execution.state.goalRendezvousEstablished === true)
      return { ...executorFeedback(input), state, progress, status: 'failed', phase: 'berth-mismatch',
        reasons: [{ executor: input.execution.executor, outcome: 'abandoned', reason: 'berth-mismatch', unitIds: [boat.hull.id] }] };
    if (!ready) {
      for (const unit of waiting) if (unit.order.type === 'board' || unit.order.type === 'move' && unit.order.deckShipId === boat.hull.id)
        commands.push({ command: { type: 'holdPosition', unitIds: [unit.id] }, purpose: 'task' });
      if (!(boat.hull.order.type === 'move' && distance(boat.hull.order, water) < 1e-6))
        commands.push({ command: { type: 'move', unitIds: [boat.hull.id], ...water, avoidCombat: true }, purpose: 'task' });
      return { ...active(input, 'rendezvous', commands, state), progress };
    }
    if (!convoyCanCarry(input.snapshot, [boat.hull], [...boat.cargo, ...waiting])) return blockedExecutor(input, 'goal-manifest-does-not-fit-native-deck');
    for (const unit of waiting) if (!busy(unit) && !(unit.order.type === 'board' && unit.order.transportId === boat.hull.id))
      commands.push({ command: { type: 'board', unitIds: [unit.id], transportId: boat.hull.id }, purpose: 'task' });
    return { ...active(input, 'loading', commands, { ...state, goalRendezvousEstablished: true }), progress };
  }
  for (const unit of loaded) if (!busy(unit) && unit.order.type !== 'hold')
    commands.push({ command: { type: 'holdPosition', unitIds: [unit.id] }, purpose: 'task' });
  if (boat.hull.order.type !== 'unload' || distance(boat.hull.order, destination) >= 1e-6)
    commands.push({ command: { type: 'unload', unitIds: [boat.hull.id], ...destination }, purpose: 'task' });
  const started = goalPoint(input.execution.state.goalDeparturePose), sailing = started && distance(boat.hull, started) > 32;
  if (sailing && input.execution.state.goalSailingObserved !== true) progress.push({ kind: 'sailed', unitIds: loaded.map(unit => unit.id), entityIds: [boat.hull.id], basis: 'observed-world' });
  return { ...active(input, sailing ? 'sailing' : 'departing', commands, { ...state, goalDeparturePose: started ?? { x: boat.hull.x, y: boat.hull.y },
    goalSailingObserved: input.execution.state.goalSailingObserved === true || !!sailing }), progress };
}
const kinds = ['assemble', 'clear-camp', 'clear-shore', 'defend', 'evacuate', 'position-transport', 'transport-force', 'transport-worker'] as const;
/** Separate registrations are selected by the single ready-action bridge. No
 * recipe provider, alternate grant or direct native-command entry is added. */
export const goalNavalExecutors: readonly StrategyExecutor[] = kinds.map(kind => ({
  id: `goal.${kind}`,
  execute(input) {
    const intent = goalActionIntent(input, kind);
    if (!intent || input.execution.executor !== this.id || intent.outputs.length) return blockedExecutor(input, 'goal-naval-intent-or-grant-invalid');
    const parameters = intent.parameters;
    const feedback = (() => { switch (kind satisfies GoalActionKind) {
      case 'assemble': return assemble(input, parameters);
      case 'clear-camp': return clearing(input, parameters, false);
      case 'clear-shore': return clearing(input, parameters, true);
      case 'defend': return defend(input, parameters);
      case 'evacuate': return evacuate(input, parameters);
      case 'position-transport': return position(input, parameters);
      case 'transport-force': case 'transport-worker': return transport(input, parameters);
    } })();
    const acknowledged = new Set(feedback.handoffs.map(item => item.eventId));
    const handoffs = input.events.flatMap(event => event.kind === 'preempted' && event.handoff === 'pending'
      && sameAction(event.action, input.execution.token) && !acknowledged.has(event.id)
      ? [{ eventId: event.id, disposition: feedback.status === 'failed' ? 'fail' as const
        : feedback.status === 'blocked' ? 'pause' as const : 'shrink' as const }] : []);
    return { ...feedback, handoffs: [...feedback.handoffs, ...handoffs] };
  },
}));
