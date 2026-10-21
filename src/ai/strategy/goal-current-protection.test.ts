import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { effectiveCombatRating } from '../policy/v6/strength';
import { defenseThreatScenarios } from './defense-risk';
import { goalFact } from './goal-facts';
import { readGoalCurrentProtection } from './goal-current-protection';
import { assessGoalDefenseCombatOption } from './goal-naval-assessment';
import { withGoalPlannerInput } from './goal-planner-input';
import type { GoalCombatOption, GoalEstimate, GoalPlanningContext } from './goal-planner-types';
import { evaluateSituation } from './situation';

const known = <T>(value: T): GoalEstimate<T> => ({ state: 'met', value, factIds: ['native-contract-input'] });
function fixture(run: (context: GoalPlanningContext, quote: GoalCombatOption, ids: string[]) => void) {
  let scene = sketchScene('current-admitted-defense-protection').map('bareDuel').replaceDefaults()
    .player('us', { team: 'us' }).player('foe', { team: 'foe' }).townHall('us', 1000, 1000, { id: 'hall' })
    .unit('foe', 'footman', 1050, 1000, { id: 'foe', order: { type: 'attack', targetId: 'hall' } });
  for (let n = 0; n < 4; n++) scene = scene.unit('us', 'footman', 980, 980 + n * 12, { id: `guard-${n}` });
  const snapshot = snapshotGame(scene.build().createGame()), before = JSON.stringify(snapshot);
  withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory: createAiPolicyMemory(), goals: [] }, input => {
    const context = input.context, target = { entityId: 'hall', landId: 'land:1', point: { x: 1000, y: 1000 } } as const;
    const units = snapshot.units.filter(unit => unit.owner === 'us'), ids = units.map(unit => unit.id);
    const effect = goalFact({ kind: 'site-safe', site: target, throughTick: snapshot.tick + 2400 });
    expect(context.readFact(effect).state).toBe('unmet');
    // This contract consumes a published native quote, independently of the
    // normal source's incremental route-publication schedule.
    const published = evaluateSituation(snapshot, 'us', createAiPolicyMemory());
    const threat = published.lands.flatMap(land => land.threats).find(threat => threat.siteId === 'hall')!;
    const opponents = snapshot.units.filter(unit => unit.owner === 'foe');
    const cohort = units.map(assessment => ({ reference: { kind: 'existing' as const, entityId: assessment.id }, assessment }));
    const result = assessGoalDefenseCombatOption({ snapshot, situation: published, effect, cohort, from: target, target,
      byTick: snapshot.tick + 2400, routes: [], arrivalTicks: known(0), movementRisk: known({ expectedLossGold: 0, survivalProbability: 1 }),
      requiredCombatRating: known(opponents.reduce((sum, unit) => sum + effectiveCombatRating(snapshot, unit), 0) * 1.25),
      defense: known({ threat: defenseThreatScenarios(threat, { status: 'none' }), opponents: opponents.map(unit => ({ unit, share: 1 })),
        hostileTowers: [], windowTicks: 2400, staticForce: 0, onStation: cohort.map(member => member.reference) }) });
    if (result.state !== 'met') throw Error(JSON.stringify(result));
    const quote = result.candidates[0]!;
    run({ ...context, grounding: { ...context.grounding!, combatOptions: () => ({ state: 'met', candidates: [quote], factIds: quote.factIds }) } }, quote, ids);
  });
  expect(JSON.stringify(snapshot)).toBe(before);
}

it('keeps a real priced sufficient defense executable while an observed enemy is present', () => fixture((context, quote, ids) => {
  expect(quote.cost.state).toBe('met'); expect(quote.successProbability.state).toBe('met');
  // This four-to-one native battle prices zero expected deaths; its genuine
  // protection probability remains below one. Do not invent a loss floor.
  if (quote.cost.state === 'met') expect(quote.cost.value.reduce((sum, term) => sum + term.gold, 0)).toBeGreaterThanOrEqual(0);
  if (quote.successProbability.state === 'met') expect(quote.successProbability.value).toBeLessThan(1);
  expect(readGoalCurrentProtection(context, 'defend', { entityId: 'hall', landId: 'land:1', point: { x: 1000, y: 1000 } }, ids, 2400).state).toBe('met');
}));

it('does not borrow a larger quoted cohort or waive unpublished conditional protection', () => fixture((context, quote, ids) => {
  const site = { entityId: 'hall', landId: 'land:1', point: { x: 1000, y: 1000 } } as const;
  expect(readGoalCurrentProtection(context, 'defend', site, [ids[0]!], 2400).state).toBe('unmet');
  const condition = goalFact({ kind: 'camp-cleared', campId: 'unpublished-camp-condition' });
  const conditional = { ...quote, preconditions: [...quote.preconditions, condition] };
  const pendingContext: GoalPlanningContext = { ...context, readFact: fact => fact.id !== condition.id ? context.readFact(fact)
    : { fact, state: 'pending', observedTick: context.tick, requestedTick: context.tick, requestId: condition.id, revision: 'contract', evidence: [],
      reason: { code: 'contract-unpublished-condition', factIds: [condition.id], values: {} } },
    grounding: { ...context.grounding!, combatOptions: () => ({ state: 'met', candidates: [conditional], factIds: [] }) } };
  expect(readGoalCurrentProtection(pendingContext, 'defend', site, ids, 2400).state).toBe('pending');
}));

it('does not use the price of a newly selected post to protect the old execution post', () => fixture((context, quote, ids) => {
  const site = { entityId: 'hall', landId: 'land:1', point: { x: 1000, y: 1000 } } as const;
  const previousPost = { ...site, point: { x: 990, y: 1000 } };
  expect(quote.target).toEqual(site);
  expect(readGoalCurrentProtection(context, 'defend', site, ids, 2400, previousPost)).toMatchObject({ state: 'pending',
    reason: { code: 'current-protection-post-unquoted' } });
  expect(readGoalCurrentProtection(context, 'defend', site, ids, 2400, site).state).toBe('met');
}));
