import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { withNativeLandRoadReuse } from '../policy/land-road';
import { mobileCare } from '../bootstrap_1/mobile-care';
import { planAiOwnerCommandEntries } from '../planner-context';
import { planAiOwnerCommandEntriesWithTrace } from '../plan-trace-planner';
import { generateNavalObjectives, decomposeNavalObjective } from './naval-objectives';
import { buildStrategyPlanTrace, mergeIdleForces } from './plan';
import { evaluateSituation } from './situation';
import { originalPolicyMemory } from './observation-memory';
import type { StrategyPlanTrace } from './types';

const policyOnly = (value: AiPolicyMemory | Scene) => JSON.stringify('snapshot' in value
  ? { ...value, memory: originalPolicyMemory(value.memory) } : originalPolicyMemory(value));

type Scene = { event: string; owner: string; snapshot: GameSnapshot; memory: AiPolicyMemory };
const frames: Scene[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases;
const plans = new Map<string, StrategyPlanTrace>();
describe('proposed strategy plans at recorded conflict events', () => {
  beforeAll(() => {
    for (const original of frames) {
      const frame = structuredClone(original), before = policyOnly(frame);
      setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
      evaluateSituation(frame.snapshot, frame.owner, frame.memory);
      const plan = withNativeLandRoadReuse(() => buildStrategyPlanTrace(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, undefined, Infinity));
      expect(policyOnly(frame)).toBe(before);
      plans.set(frame.event, plan);
    }
  });
  it('ranks E01 timely home defense above starting another island voyage', () => {
    const plan = plans.get('E01')!;
    const home = plan.objectives.find(goal => goal.id === 'DefendSite:p0:building-p0-townHall-1166')!;
    const second = plan.objectives.find(goal => goal.id === 'ConquerIsland:p0:gold-gen-3')!;
    expect(home.utility.score).toBeGreaterThan(0);
    expect(home.rank).toBeLessThan(second.rank!);
    expect(plan.methods.filter(method => method.objectiveId === home.id).map(method => method.kind))
      .toEqual(['local-squad', 'main-army-recall', 'cross-sea-reinforcement']);
  });
  it('identifies E02 threatened island and does not quote an untimely rescue as successful', () => {
    const plan = plans.get('E02')!, id = 'DefendSite:p0:building-p0-townHall-9337';
    const goal = plan.objectives.find(goal => goal.id === id)!;
    expect(goal.reasons.some(reason => reason.code === 'no-timely-response')).toBe(true);
    expect(goal.utility.successProbability).toBe(0);
    expect(goal.utility.score).toBeNull(); expect(goal.rank).toBeNull();
    expect(plan.feasibleObjectiveIds).not.toContain(goal.id);
    expect(plan.blockedObjectives.find(quote => quote.objectiveId === id)).toMatchObject({ potentialUtility: null });
    expect(plan.objectives.find(goal => goal.id === 'Evacuate:p0:building-p0-townHall-9337')!.status).toBe('blocked');
    expect(plan.methods.filter(method => method.objectiveId === id).every(method => method.status === 'blocked')).toBe(true);
  });
  it('does not generate E05 unnecessary reinforcement for the safe completed colony', () => {
    const plan = plans.get('E05')!, colony = plan.objectives.find(goal => goal.id === 'ConquerIsland:p0:gold-gen-6')!;
    expect(colony.status).toBe('complete');
    expect(plan.objectives.some(goal => goal.kind === 'ReinforceFront' && goal.target.landId === colony.target.landId)).toBe(false);
    const attack = plan.assignments.filter(assignment => assignment.objectiveId === 'AttackSite:p0:building-p3-townHall-7099');
    expect(attack.length).toBeGreaterThan(0);
    expect(attack.every(assignment => assignment.authority === 'observed')).toBe(true);
  });
  it('keeps Nd outgoing passengers out of on-station home defense', () => {
    const plan = plans.get('Nd')!, passengers = plan.situation.units.filter(unit => unit.location.kind === 'aboard');
    for (const unit of passengers) expect(plan.assignments.filter(assignment => assignment.unitId === unit.id)
      .every(assignment => assignment.stage !== 'on-station')).toBe(true);
    expect(plan.objectives.some(goal => goal.id === 'DefendSite:enemy:building-enemy-townHall-1622')).toBe(true);
  });
  it('decomposes Ne into exact four-unit handoff, transport and later hall capital', () => {
    const plan = plans.get('Ne')!, goal = plan.objectives.find(goal => goal.id === 'ConquerIsland:player-4:gold-satellite-2')!;
    const method = plan.methods.find(method => method.objectiveId === goal.id)!;
    const borrow = method.subgoals.find(step => step.kind === 'borrow-force')!;
    for (const suffix of [5287, 5642, 5789, 5909]) expect(borrow.reasons[0]!.detail).toContain(`unit-player-4-emberRavager-${suffix}`);
    expect(method.preconditions.find(condition => condition.kind === 'handoff')!.status).toBe('unmet');
    expect(method.subgoals.map(step => step.kind)).toEqual(expect.arrayContaining(['train-transport', 'deliver-force', 'clear-camp', 'wait-income', 'build-hall', 'establish-garrison']));
    expect(method.demands.find(demand => demand.kind === 'transport')).toMatchObject({ payloadMass: expect.any(Number) });
    const transport = method.demands.find(demand => demand.kind === 'transport')!;
    if (transport.kind === 'transport') expect(transport.payloadMass).toBeGreaterThan(300);
    const capital = plan.budget.filter(entry => entry.objectiveId === goal.id);
    expect(capital.reduce((sum, entry) => sum + entry.gold, 0)).toBeGreaterThan(plan.situation.economy.cashGold);
    expect(capital.every(entry => entry.authority === 'proposed' && entry.state === 'proposed')).toBe(true);
    expect(plan.situation.economy.ledger).toEqual([]);
    const support = plan.objectives.find(candidate => candidate.supportsObjectiveIds?.includes(goal.id))!;
    expect(support.utility.score).toBe(goal.utility.score);
  });
  it('does not invent a training deficit when possible clearing troops have unquoted routes', () => {
    const frame = structuredClone(frames.find(frame => frame.event === 'Ne')!);
    const assessed = evaluateSituation(frame.snapshot, frame.owner, frame.memory);
    const situation = { ...assessed, units: assessed.units.map(unit => unit.owner === frame.owner ? { ...unit, arrivals: [] } : unit) };
    const context = { snapshot: frame.snapshot, owner: frame.owner, memory: frame.memory };
    const goal = generateNavalObjectives(situation, context, []).find(goal => goal.id === 'ConquerIsland:player-4:gold-satellite-2')!;
    expect(goal.status).toBe('blocked');
    expect(goal.reasons.some(reason => reason.code === 'clearing-arrivals-unknown')).toBe(true);
    const method = decomposeNavalObjective(situation, goal, context)[0]!;
    expect(method.preconditions.some(condition => condition.status === 'unknown' && condition.reason.code === 'clearing-arrivals-unknown')).toBe(true);
    expect(method.subgoals.some(step => step.kind === 'train-force')).toBe(false);
  });
  it('keeps all subgoal links local and all plan numbers finite', () => {
    for (const plan of plans.values()) {
      expect(plan.mode).toBe('observe');
      expect(new Set(plan.assignments.map(assignment => assignment.id)).size).toBe(plan.assignments.length);
      for (const method of plan.methods) {
        const ids = new Set(method.subgoals.map(step => step.id));
        for (const step of method.subgoals) expect(step.dependsOn.every(id => ids.has(id))).toBe(true);
        for (const precondition of method.preconditions) expect(precondition.subgoalIds.every(id => ids.has(id))).toBe(true);
      }
      JSON.stringify(plan, (_key, value) => { if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true); return value; });
    }
  });
  it('keeps cold runtime geometry explicitly unknown while exposing every component', () => {
    const frame = structuredClone(frames.find(frame => frame.event === 'E01')!);
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    const before = policyOnly(frame);
    const plan = withNativeLandRoadReuse(() => buildStrategyPlanTrace(frame.snapshot, frame.owner, { memory: frame.memory }));
    expect(plan.limitations.some(reason => reason.code === 'geometry-refresh-pending')).toBe(true);
    for (const blocked of plan.objectives.filter(objective => objective.status === 'blocked')) {
      expect(blocked.utility.score).toBeNull(); expect(blocked.rank).toBeNull();
      expect(plan.feasibleObjectiveIds).not.toContain(blocked.id);
      expect(plan.blockedObjectives.some(quote => quote.objectiveId === blocked.id)).toBe(true);
    }
    expect(plan.limitations.some(reason => reason.code === 'shore-index-refresh-pending')).toBe(false);
    expect(plan.situation.units.flatMap(unit => unit.arrivals).some(entry => entry.arrival.status === 'unknown'
      && entry.arrival.reason.code === 'geometry-refresh-pending')).toBe(true);
    expect(plan.situation.lands.length).toBe(plans.get('E01')!.situation.lands.length);
    expect(plan.situation.seas.length).toBe(plans.get('E01')!.situation.seas.length);
    expect(policyOnly(frame)).toBe(before);
  });
  it('marks L3 mobile care as a life-saving interruption of the original guard assignment', () => {
    const frame: Scene = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/recovery-L3.json.gz', import.meta.url))).toString());
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    evaluateSituation(frame.snapshot, frame.owner, frame.memory);
    const plan = withNativeLandRoadReuse(() => buildStrategyPlanTrace(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, undefined, Infinity));
    const assignment = plan.assignments.find(assignment => assignment.unitId === 'unit-player-ashChieftain-3872')!;
    expect(assignment).toMatchObject({ objectiveId: 'DefendSite:player:building-player-townHall-5459',
      stage: 'life-saving-interruption', interruption: { kind: 'healing' } });
  });
  it('projects L3 accepted healing orders without running another mobile-care selection', () => {
    const load = (): Scene => JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/recovery-L3.json.gz', import.meta.url))).toString());
    const plain = load(), observed = load(), spy = vi.spyOn(mobileCare as Required<Pick<typeof mobileCare, 'claimsUnits'>>, 'claimsUnits');
    try {
      const commands = planAiOwnerCommandEntries(plain.snapshot, { playerId: plain.owner, version: 'v9_knight', memory: plain.memory });
      const selections = spy.mock.calls.length; spy.mockClear();
      const result = planAiOwnerCommandEntriesWithTrace(observed.snapshot, { playerId: observed.owner, version: 'v9_knight', memory: observed.memory });
      expect(result.commands).toEqual(commands);
      expect(spy.mock.calls.length).toBe(selections);
      expect(result.commands.some(entry => entry.scriptId === 'mobileCare' && 'unitIds' in entry.command
        && entry.command.unitIds.includes('unit-player-ashChieftain-3872'))).toBe(true);
      expect(result.trace.strategy!.situation.units.find(unit => unit.id === 'unit-player-ashChieftain-3872')!.commitments)
        .toContainEqual(expect.objectContaining({ source: 'mobileCare.accepted-plan', evidence: expect.objectContaining({ certainty: 'recorded' }) }));
      expect(policyOnly(observed.memory)).toBe(policyOnly(plain.memory));
      expect(JSON.stringify(observed.snapshot)).toBe(JSON.stringify(plain.snapshot));
    } finally { spy.mockRestore(); }
  });
  it('prices idle alternatives once per unit across all families', () => {
    const plan = plans.get('E01')!, prototype = plan.situation.units.find(unit => unit.owner === plan.owner && unit.location.kind === 'land' && !unit.roles.includes('worker'))!;
    const units = [{ ...prototype, id: 'a', commitments: [] }, { ...prototype, id: 'b', commitments: [] }];
    const [first, second] = plan.objectives.filter(goal => goal.utility.score !== null && goal.utility.score > 0);
    const reason = { code: 'feasible-alternative', detail: 'Quoted against the complete family set', evidence: [] };
    const idle = mergeIdleForces([{ unitIds: ['a', 'b'], opportunityCostGold: 20, alternativeObjectiveId: first!.id, reason },
      { unitIds: ['a'], opportunityCostGold: 30, alternativeObjectiveId: second!.id, reason }], { ...plan.situation, units }, plan.objectives);
    expect(idle).toHaveLength(2);
    expect(idle.find(quote => quote.unitIds.includes('a'))).toMatchObject({ opportunityCostGold: 30, alternativeObjectiveId: second!.id });
    expect(idle.find(quote => quote.unitIds.includes('b'))).toMatchObject({ opportunityCostGold: 10, alternativeObjectiveId: first!.id });
  });
});
