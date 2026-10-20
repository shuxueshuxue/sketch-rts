import { UNIT_DEFS, unitMover } from '../../shared/catalog';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { withGoalDistanceFieldLease } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { distance } from '../policy/spatial';
import type { ExecutableMethod } from './allocation-types';
import { createArrivalQuery, crossingCandidateId, EXACT_CROSSING_CANDIDATES } from './arrivals';
import type { DecisionFacts } from './decision';
import { createPlanningDistanceQuery } from './distance-fields';
import { decisionProjection } from './explanations';
import { withStrategyFrame } from './frame-reuse';
import { boundObservationMemory, observationMemory } from './observation-memory';
import { regionIndex } from './regions';
import type { Situation, SituationUnit } from './types';
import { arrivalColumns, unitArrivalFacts, withDecisionUnitArrivals } from './unit-arrivals';

/** A control-only continuation of the same shared arrival evaluator. The key is
 * the actual action id and post, never the associated hall/mine's centre. */
export const ALLOCATION_ETA_TARGETS = 16;
export const ALLOCATION_ETA_CANDIDATES_PER_LAND = 24;
export function withAllocationMethodArrivals(snapshot: GameSnapshot, owner: string, memory: AiPolicyMemory,
  situation: DecisionFacts<Situation>, methods: readonly ExecutableMethod[], fieldBudget = 1): DecisionFacts<Situation> {
  return withGoalDistanceFieldLease(snapshot.map, owner, snapshot.tick, () => withStrategyFrame(() => decisionProjection(() => {
    const preparation = observationMemory(snapshot, owner, memory), regions = regionIndex(snapshot.map);
    const distances = createPlanningDistanceQuery(snapshot, fieldBudget, 'land', preparation);
    const query = createArrivalQuery(snapshot, owner, memory, distances, fieldBudget, regions, preparation);
    const live = new Map(snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0).map(unit => [unit.id, unit]));
    const units = new Map(situation.units.map(unit => [unit.id, unit]));
    const actionObjective = new Map(methods.flatMap(method => method.actions.map(action => [action.id, method.objectiveId] as const)));
    const threatened = new Set(situation.lands.flatMap(land => land.threats.filter(threat => threat.arrivedStrength > 0).map(threat => threat.siteId)));
    const goals = methods.flatMap(method => method.actions).filter(action =>
      action.target.landId && ['strategy.defend-site', 'strategy.evacuate', 'strategy.assemble'].includes(action.executor))
      .sort((a, b) => Number(Boolean(memory.strategyAllocation?.executions[b.id])) - Number(Boolean(memory.strategyAllocation?.executions[a.id]))
        || Number(threatened.has(b.target.entityId ?? '')) - Number(threatened.has(a.target.entityId ?? ''))
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Methods sharing a post share one field. The cap counts physical targets,
    // not duplicate method ids for the same point.
    const points = new Set<string>();
    const targets = [...new Map(goals.map(goal => [goal.id, goal])).values()].filter(goal => {
      const point = `${goal.target.point.x}:${goal.target.point.y}`;
      const active = memory.strategyAllocation?.executions[goal.id];
      if (!active && !points.has(point) && points.size >= ALLOCATION_ETA_TARGETS) return false;
      points.add(point); return true;
    });
    const candidates = new Map<string, Set<string>>();
    const crossings = new Map<string, number>();
    for (const action of targets) {
      const pool = [...live.values()].filter(unit => unitMover(unit.kind) === 'land'
        && (action.intent.kind === 'evacuate' ? unit.kind === 'worker' : unit.kind !== 'worker'))
        .sort((a, b) => distance(a, action.target.point) - distance(b, action.target.point) || (a.id < b.id ? -1 : 1));
      const selected = new Set<string>(), origins = new Map<string, number>();
      for (const unit of pool) {
        const fact = units.get(unit.id)!;
        const origin = fact.location.kind === 'land' ? fact.location.landId : fact.location.kind === 'aboard' ? fact.location.shipId : 'unknown';
        const count = origins.get(origin) ?? 0;
        const leased = memory.strategyAllocation?.leases[`unit:${unit.id}`]?.objectiveId === actionObjective.get(action.id);
        if (count >= ALLOCATION_ETA_CANDIDATES_PER_LAND && !leased) continue;
        selected.add(unit.id); origins.set(origin, count + 1);
        const key = crossingCandidateId(snapshot, unit, action.target);
        if (key) {
          const lower = distance(fact.location.point, action.target.point) * SIM_TICKS_PER_SECOND / Math.max(unit.speed, UNIT_DEFS.transport.speed);
          const old = crossings.get(key); if (old === undefined || lower < old) crossings.set(key, lower);
        }
      }
      candidates.set(action.id, selected);
    }
    query.setCrossingShortlist([...crossings].sort(([a, x], [b, y]) => x - y || (a < b ? -1 : 1))
      .slice(0, EXACT_CROSSING_CANDIDATES).map(([id]) => id));
    const projected = situation.units.map(unit => {
      const actor = live.get(unit.id);
      if (!actor || !targets.some(goal => candidates.get(goal.id)?.has(unit.id))) return unit;
      const stored = unitArrivalFacts(unit);
      const oldIds = stored?.columns.ids ?? unit.arrivals.map(entry => entry.targetId);
      const oldValues = stored?.values ?? unit.arrivals.map(entry => entry.arrival);
      const ids = [...oldIds], values = [...oldValues];
      for (const goal of targets) {
        if (!candidates.get(goal.id)?.has(unit.id)) continue;
        const arrival = query.arrival(actor, goal.target, unit.location.kind === 'land' ? unit.location.landId : undefined);
        const index = ids.indexOf(goal.id);
        if (index < 0) { ids.push(goal.id); values.push(arrival); }
        else values[index] = arrival;
      }
      return withDecisionUnitArrivals({ id: unit.id, owner: unit.owner, kind: unit.kind, location: unit.location, hp: unit.hp,
        maxHp: unit.maxHp, strength: unit.strength, roles: unit.roles, expiresTick: unit.expiresTick, commitments: unit.commitments },
      { columns: arrivalColumns(ids), values, count: values.filter(Boolean).length }) satisfies DecisionFacts<SituationUnit>;
    });
    boundObservationMemory(preparation);
    return { ...situation, units: projected };
  }, false).facts));
}
