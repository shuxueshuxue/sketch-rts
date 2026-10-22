import type { ExecutionAction, ExecutionState, StrategyAllocationMemory, AllocationEvent } from './allocation-types';
import { appendAllocationEvent } from './allocation-lifecycle';
import { ASSEMBLY_RANGE } from './assembly-posts';
import { readGoalIntent } from './goal-authority-references';
import { goalEntityId, goalEntityIds, goalRecord, goalTarget } from './goal-executor-parameters';
import { goalFact, goalValueKey } from './goal-facts';
import type { GoalPlanningContext } from './goal-planner-types';
import { sameAction } from './control';
import { reservedAllocationGold } from './allocation-ledger';

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
const union = (...rows: readonly (readonly string[])[]) => [...new Set(rows.flat())].sort();
type Progress = Extract<AllocationEvent, { kind: 'progress' }>['progress'];

/** World effects settle admitted atoms even after their leases pass to a new
 * generation. These receipts grant no command, payment, kill or birth credit.
 * Native region observations come from the already prepared Situation. */
export function reconcileGoalWorldExecutions(memory: StrategyAllocationMemory, context: GoalPlanningContext): StrategyAllocationMemory {
  if (context.owner !== memory.owner || context.snapshot.tick !== context.tick || context.situation.tick !== context.tick
    || memory.evaluatedTick > context.tick) return memory;
  const actualUnits = new Map(context.snapshot.units.filter(unit => unit.owner === context.owner && unit.hp > 0).map(unit => [unit.id, unit]));
  const observedUnits = new Map(context.situation.units.map(unit => [unit.id, unit]));
  const transports = new Map<string, string[]>();
  const family = (action: ExecutionAction) => {
    if (action.intent.kind !== 'goal-action' || !['transport-force', 'transport-worker'].includes(action.intent.actionKind)) return null;
    const p = readGoalIntent(memory, action.intent).parameters, cohort = goalEntityIds(p.cohort), ship = goalEntityId(p.transport), at = goalTarget(p.at);
    return cohort?.length && ship && at?.landId ? { p, cohort, ship, at,
      key: goalValueKey([action.objectiveId, cohort, ship, at.landId]) } : null;
  };
  for (const action of Object.values(memory.executions)) {
    const transport = family(action); if (!transport) continue;
    const aboard = transport.cohort.filter(id => {
      const unit = actualUnits.get(id), observation = observedUnits.get(id);
      return unit && observation?.location.kind === 'aboard' && observation.location.shipId === transport.ship;
    });
    transports.set(transport.key, union(transports.get(transport.key) ?? [], strings(action.state.goalLoadedIds), aboard));
  }
  for (const action of Object.values(memory.executions).sort((a, b) => a.token.actionId.localeCompare(b.token.actionId))) {
    if (['complete', 'failed', 'abandoned'].includes(action.status) || action.sinceTick > context.tick || action.intent.kind !== 'goal-action') continue;
    const intent = readGoalIntent(memory, action.intent), p = intent.parameters, read = context.readFact;
    let state: ExecutionState = action.state, complete = false, phase = action.phase;
    let progress: Progress | undefined, unitIds: readonly string[] = [], entityIds: readonly string[] = [];
    const transport = family(action);
    if (transport) {
      const loaded = transports.get(transport.key) ?? [], landed = transport.cohort.filter(id => {
        const unit = actualUnits.get(id), observation = observedUnits.get(id);
        return unit && !unit.deck && !unit.cabin && observation?.location.kind === 'land'
          && observation.location.landId === transport.at.landId;
      });
      state = { ...state, goalLoadedIds: loaded, goalLandedIds: union(strings(state.goalLandedIds), landed) };
      complete = landed.length === transport.cohort.length;
      if (complete) { phase = 'delivered'; progress = 'unloaded'; unitIds = landed; }
    } else if (intent.actionKind === 'build') {
      const at = goalTarget(p.at), bindings = goalRecord(state.goalOutputBindings);
      const id = typeof p.foundationId === 'string' ? p.foundationId : typeof bindings?.building === 'string' ? bindings.building : null;
      const building = id && context.snapshot.buildings.find(building => building.id === id && building.owner === context.owner
        && building.hp > 0 && building.complete && building.kind === p.buildingKind && at
        && building.x === at.point.x && building.y === at.point.y);
      if (building) { complete = true; phase = 'building-complete-observed'; progress = 'hall-complete'; entityIds = [building.id]; }
    } else if (intent.actionKind === 'clear-camp' && typeof p.campId === 'string') {
      const fact = goalFact({ kind: 'camp-cleared', campId: p.campId }), observed = read(fact);
      if (observed.fact.id === fact.id && observed.state === 'met' && observed.observedTick === context.tick
        && (observed.availableTick ?? context.tick) <= context.tick) {
        complete = true; phase = 'beachhead-clear'; progress = 'camp-cleared';
        unitIds = goalEntityIds(p.cohort) ?? []; entityIds = strings(p.memberIds);
      }
    } else if (intent.actionKind === 'assemble') {
      const at = goalTarget(p.at), cohort = goalEntityIds(p.cohort);
      complete = !!at?.landId && !!cohort?.length && cohort.every(id => {
        const unit = actualUnits.get(id), observed = observedUnits.get(id);
        return unit && !unit.deck && !unit.cabin && observed?.location.kind === 'land' && observed.location.landId === at.landId
          && Math.hypot(unit.x - at.point.x, unit.y - at.point.y) <= ASSEMBLY_RANGE;
      });
      if (complete) { phase = 'assembly-observed'; unitIds = cohort!; }
    } else if (intent.actionKind === 'position-transport') {
      const ship = goalEntityId(p.transport), at = goalTarget(p.at), tolerance = p.tolerance;
      if (ship && at && typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance >= 0) {
        const fact = goalFact({ kind: 'transport-at', transport: { kind: 'existing', entityId: ship }, at, tolerance,
          byTick: typeof p.byTick === 'number' ? p.byTick : context.tick });
        const observed = read(fact);
        complete = observed.state === 'met' && observed.fact.id === fact.id && observed.observedTick === context.tick;
        if (complete) { phase = 'transport-position-observed'; unitIds = [ship]; }
      }
    } else if (intent.actionKind === 'destroy-target' || intent.actionKind === 'engage-units' || intent.actionKind === 'evacuate' || intent.actionKind === 'clear-shore') {
      const at = goalTarget(p.target ?? p.at ?? p.shelter), through = p.throughTick;
      const cohort = goalEntityIds(p.cohort) ?? strings(p.unitIds), threats = strings(p.threatUnitIds ?? p.threatIds);
      const fact = !at ? null : intent.actionKind === 'destroy-target' ? goalFact({ kind: 'enemy-site-destroyed', site: at })
        : typeof through !== 'number' || !Number.isFinite(through) ? null
        : intent.actionKind === 'engage-units' ? goalFact({ kind: 'harassment-ended', site: at, throughTick: through,
          ...(threats.length ? { unitIds: threats } : {}) })
        : intent.actionKind === 'clear-shore' && at.landId ? goalFact({ kind: 'shore-safe', landId: at.landId, landing: at, throughTick: through })
        : intent.actionKind === 'evacuate' ? goalFact({ kind: 'assets-safe', unitIds: cohort, at, throughTick: through }) : null;
      if (fact) {
        const observed = read(fact);
        complete = observed.state === 'met' && observed.observedTick === context.tick && observed.fact.id === fact.id
          && (observed.availableTick ?? context.tick) <= context.tick;
        if (complete) { phase = 'world-effect-observed'; unitIds = cohort; entityIds = threats; }
      }
    } else if (intent.actionKind === 'wait-income' && typeof p.minimumGold === 'number' && Number.isFinite(p.minimumGold) && p.minimumGold >= 0) {
      complete = (context.snapshot.players[context.owner]?.gold ?? 0) - reservedAllocationGold(memory, action.objectiveId) >= p.minimumGold;
      if (complete) phase = 'free-gold-observed';
    } else if (intent.actionKind === 'train' && typeof p.count === 'number' && Number.isSafeInteger(p.count) && p.count >= 1) {
      complete = (memory.goalTraining?.jobs.filter(job => sameAction(job.action, action.token) && job.state === 'fulfilled').length ?? 0) >= p.count;
      if (complete) phase = 'training-pool-quantity-fulfilled';
    }
    if (!complete && goalValueKey(state) === goalValueKey(action.state)) continue;
    if (complete) state = { ...state, goalWorldEffectTick: context.tick, goalWorldUnitIds: unitIds, goalWorldEntityIds: entityIds };
    memory = { ...memory, executions: { ...memory.executions, [action.token.actionId]: { ...action, state,
      ...(complete ? { status: 'complete', phase, lastProgressTick: context.tick } : {}) } } };
    if (!complete) continue;
    const reason = { code: 'observed-goal-world-effect', factIds: [...unitIds, ...entityIds], values: { actionKind: intent.actionKind } };
    if (progress) memory = appendAllocationEvent(memory, { kind: 'progress', progress, unitIds, entityIds,
      objectiveId: action.objectiveId, methodId: action.methodId, action: action.token, reason }, context.tick);
    memory = appendAllocationEvent(memory, { kind: 'action-finished', outcome: 'complete', objectiveId: action.objectiveId,
      methodId: action.methodId, action: action.token, reason }, context.tick);
  }
  return memory;
}
