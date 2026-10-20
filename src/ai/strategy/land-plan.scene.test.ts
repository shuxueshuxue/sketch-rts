import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { withNativeLandRoadReuse } from '../policy/land-road';
import { planAiOwnerCommandEntries } from '../planner-context';
import { planAiOwnerCommandEntriesWithTrace } from '../plan-trace-planner';
import { buildStrategyPlanTrace, NAVAL_OBJECTIVE_FAMILY } from './plan';
import { LAND_OBJECTIVE_FAMILY } from './land-objectives';
import type { PlanningContext, StrategyPlanTrace } from './types';

type Frame = { event: string; context: PlanningContext };
const frames: Frame[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/land-objective-event-frames.json.gz', import.meta.url))).toString()).cases;
const families = [NAVAL_OBJECTIVE_FAMILY, LAND_OBJECTIVE_FAMILY];
const plans = new Map<string, StrategyPlanTrace>();
function policyState(context: PlanningContext) {
  const { strategy, ...policy } = context.memory;
  const { observation: _observation, ...otherStrategy } = strategy ?? {};
  return { ...context, memory: { ...policy, ...(Object.keys(otherStrategy).length ? { strategy: otherStrategy } : {}) } };
}

describe('land family in the shared strategic plan trace', () => {
  beforeAll(() => {
    for (const original of frames) {
      const { event, context } = structuredClone(original), { snapshot, owner, memory } = context;
      const before = JSON.stringify(policyState(context));
      setBuildingBodies(snapshot.map, standingBodies(snapshot));
      // Complete event facts for valuation; default runtime observation below
      // retains the shared deterministic per-think publication budget.
      const plan = withNativeLandRoadReuse(() => buildStrategyPlanTrace(snapshot, owner, { memory }, undefined, families, undefined, Infinity));
      expect(JSON.stringify(policyState(context))).toBe(before);
      plans.set(event, plan);
    }
  });

  it.each(frames.map(frame => frame.event))('%s ranks feasible quotes while keeping blocked prerequisites and potential value separate', event => {
    const plan = plans.get(event)!;
    const ranked = plan.feasibleObjectiveIds.map(id => plan.objectives.find(goal => goal.id === id)!);
    expect(new Set(plan.feasibleObjectiveIds).size).toBe(ranked.length);
    for (const [index, goal] of ranked.entries()) {
      expect(['active', 'candidate']).toContain(goal.status);
      expect(goal.rank).toBe(index + 1);
      expect(goal.utility.score).not.toBeNull();
      if (index) expect(ranked[index - 1]!.utility.score!).toBeGreaterThanOrEqual(goal.utility.score!);
    }
    for (const goal of plan.objectives.filter(goal => goal.status === 'blocked')) {
      expect(plan.feasibleObjectiveIds).not.toContain(goal.id);
      expect(goal.rank).toBeNull();
      expect(goal.utility.score).toBeNull();
      const quote = plan.blockedObjectives.find(quote => quote.objectiveId === goal.id)!;
      expect(quote).toBeDefined();
      expect(quote.missingPreconditions.length).toBeGreaterThan(0);
      if (quote.potentialUtility) expect(Number.isFinite(quote.potentialUtility.score)).toBe(true);
      expect(new Set(quote.prerequisiteCost.map(cost => cost.methodId)).size).toBe(quote.prerequisiteCost.length);
    }
  });

  it.each(['L1', 'L4', 'L5-threat', 'L5-front'])('%s values feasible home defense above a feasible land sortie', event => {
    const plan = plans.get(event)!;
    const ranked = plan.feasibleObjectiveIds.map(id => plan.objectives.find(goal => goal.id === id)!);
    const defense = ranked.find(goal => goal.kind === 'DefendSite')!;
    expect(defense.utility.score).toBeGreaterThan(0);
    expect(ranked.filter(goal => goal.kind === 'AttackSite').every(goal => goal.rank! > defense.rank!)).toBe(true);
  });

  it('L2 retains overlapping old task identities and keeps their handoff outside feasible ranking', () => {
    const plan = plans.get('L2')!, id = 'AttackSite:player:building-enemy-townHall-1944';
    for (const suffix of [1334, 1515, 1537]) {
      const assignments = plan.assignments.filter(item => item.unitId === `unit-player-archer-${suffix}`);
      expect(assignments.some(item => item.objectiveId === id)).toBe(true);
      expect(assignments.some(item => item.objectiveId === 'ExpandLand:player:gold-gen-6')).toBe(true);
    }
    const attack = plan.objectives.find(goal => goal.id === id)!;
    expect(attack.reasons.some(reason => reason.code === 'borrow-requires-handoff')).toBe(true);
    expect(plan.feasibleObjectiveIds).not.toContain(id);
    expect(plan.blockedObjectives.some(quote => quote.objectiveId === id)).toBe(true);
  });

  it.each([['L3', 'unit-player-ashChieftain-3872'], ['L4', 'unit-player-contractArcher-1923']])(
    '%s preserves the original guard assignment during medical control', (event, unitId) => {
      const plan = plans.get(event!)!;
      expect(plan.assignments).toContainEqual(expect.objectContaining({ unitId,
        objectiveId: 'DefendSite:player:building-player-townHall-5459', stage: 'life-saving-interruption',
        interruption: expect.objectContaining({ kind: 'healing' }),
      }));
      expect(plan.idleForces.flatMap(idle => idle.unitIds)).not.toContain(unitId);
    });

  it('L5 keeps island mining under its existing conquest instead of duplicating the income', () => {
    const plan = plans.get('L5-front')!;
    expect(plan.objectives.some(goal => goal.id === 'ConquerIsland:player:gold-gen-6')).toBe(true);
    expect(plan.objectives.some(goal => goal.id === 'ExpandLand:player:gold-gen-6')).toBe(false);
  });

  it('L6 retains the intended mine and its sustained-force plan without ranking an impossible attack', () => {
    const plan = plans.get('L6')!, id = 'ExpandLand:player:gold-gen-4';
    const goal = plan.objectives.find(goal => goal.id === id)!;
    expect(goal.status).toBe('blocked');
    expect(goal.rank).toBeNull();
    expect(plan.feasibleObjectiveIds).not.toContain(id);
    expect(plan.blockedObjectives.some(quote => quote.objectiveId === id)).toBe(true);
    const methods = plan.methods.filter(method => method.objectiveId === id);
    expect(methods.flatMap(method => method.subgoals).map(subgoal => subgoal.kind))
      .toEqual(expect.arrayContaining(['borrow-force', 'train-force']));
    expect(methods.every(method => method.preconditions.some(condition => condition.kind === 'force'
      && condition.status === 'unmet' && condition.demand?.kind === 'force' && condition.demand.permanent))).toBe(true);
  });

  it.each(frames.map(frame => frame.event))('%s emits default land proposals without changing commands or policy fields', event => {
    const frame = frames.find(frame => frame.event === event)!;
    const plain = structuredClone(frame.context), observed = structuredClone(frame.context);
    const version = event === 'L2' ? 'v9_archer' : event === 'L6' ? 'v9_summoner' : 'v9_knight';
    const commands = planAiOwnerCommandEntries(plain.snapshot, { playerId: plain.owner, version, memory: plain.memory });
    const result = planAiOwnerCommandEntriesWithTrace(observed.snapshot,
      { playerId: observed.owner, version, memory: observed.memory });
    expect(result.commands).toEqual(commands);
    expect(JSON.stringify(policyState(observed))).toBe(JSON.stringify(policyState(plain)));
    expect(result.trace.strategy!.objectives.some(goal => goal.kind === 'AttackSite' || goal.kind === 'ExpandLand')).toBe(true);
  });
});
