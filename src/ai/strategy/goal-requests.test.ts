import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { goalFact } from './goal-facts';
import { withGoalPlannerInput } from './goal-planner-input';
import { collectGoalRequests } from './goal-requests';
import type { GoalPlanningContext } from './goal-planner-types';
import type { DecisionFacts } from './decision';
import type { Objective } from './types';
import { situationConstructionCount } from './situation';

function game() {
  const game = sketchScene('objective-goal-collector').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' })
    .townHall('us', 350, 350).townHall('foe', 4000, 4000)
    .worker('us', 420, 350).goldMine('mine', 1800, 1800, 10000).build().createGame();
  game.scriptedVictory = true; return game;
}
function objective(context: GoalPlanningContext): DecisionFacts<Objective> {
  return { id: 'ExpandLand:us:mine', owner: 'us', kind: 'ExpandLand', status: 'blocked', target: { point: { x: 1800, y: 1800 }, entityId: 'mine' },
    effects: [{ kind: 'mining-established', mineId: 'mine', completeHall: true, garrisonHandoff: true }],
    utility: { horizonTicks: 2400, benefit: [{ code: 'mine-income', value: 600 }, { code: 'capital-on-success', value: -400 }],
      cost: [{ code: 'attrition', value: 3000 }], score: null, successProbability: 0, persistenceBonus: 50 },
    sinceTick: context.tick, rank: null, methodIds: [], reasons: [], stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
}

it('converts existing blocked objectives and copies only their positive benefit terms, never score/P/cost/persistence', () => {
  const snapshot = snapshotGame(game());
  withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory: createAiPolicyMemory(), goals: [] }, input => {
    const source = objective(input.context), before = JSON.stringify(source);
    const [goal] = collectGoalRequests([source], input.context);
    expect(goal).toMatchObject({ id: source.id, owner: 'us', rewardGold: 600, deadlineTick: null });
    expect(goal!.effects.map(fact => fact.predicate.kind)).toEqual(['hall-complete', 'garrison-ready']);
    expect(goal!.reasons.find(reason => reason.code === 'goal-objective-benefit')?.factIds).toEqual([source.id, 'mine-income']);
    expect(JSON.stringify(source)).toBe(before);
    expect(collectGoalRequests([{ ...source, status: 'complete' }], input.context)).toEqual([]);
  });
});

it('preserves each structured world effect, exact identities, deadlines and the separate field-strength currency', () => {
  const snapshot = snapshotGame(game());
  withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory: createAiPolicyMemory(), goals: [] }, input => {
    const source = objective(input.context), at = source.target;
    const effects: Objective['effects'] = [{ kind: 'site-safe', siteId: 'site', throughTick: 200 },
      { kind: 'entity-destroyed', entityId: 'enemy' }, { kind: 'route-controlled', target: at },
      { kind: 'harassment-ended', unitId: 'raider', siteId: 'site' },
      { kind: 'assets-evacuated', unitIds: ['worker'], destination: at },
      { kind: 'force-present', landId: 'land:1', minimumStrength: 7, throughTick: 300 }];
    const [goal] = collectGoalRequests([{ ...source, effects }], input.context);
    expect(goal!.deadlineTick).toBe(200);
    expect(goal!.effects).toContainEqual(goalFact({ kind: 'force-at', at: { ...at, landId: 'land:1' }, minimum: 7, metric: 'field-strength', byTick: 300 }));
    expect(goal!.effects.map(fact => fact.predicate.kind)).toEqual(['site-safe', 'enemy-site-destroyed', 'route-controlled', 'harassment-ended', 'assets-safe', 'force-at']);
    expect(goal!.effects.find(fact => fact.predicate.kind === 'harassment-ended')!.predicate).toMatchObject({ unitIds: ['raider'] });
  });
});

it('uses ordinary objective generators on exactly one native Situation, with no method decomposition or unbudgeted route', () => {
  const snapshot = snapshotGame(game()), memory = createAiPolicyMemory(), before = JSON.stringify(snapshot), count = situationConstructionCount();
  withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
    () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory }, input => {
      expect(input.goals.some(goal => goal.id === 'ExpandLand:us:mine')).toBe(true);
      expect(input.goals.find(goal => goal.id === 'ExpandLand:us:mine')!.rewardGold).toBeGreaterThan(0);
      expect(input.goals.every(goal => goal.id.startsWith('ExpandLand:') || goal.id.startsWith('AttackSite:')
        || goal.id.startsWith('ConquerIsland:') || goal.id.startsWith('DefendSite:') || goal.id.startsWith('ReinforceFront:')
        || goal.id.startsWith('CounterHarass:') || goal.id.startsWith('ContestRoute:') || goal.id.startsWith('RecoverSite:') || goal.id.startsWith('Evacuate:'))).toBe(true);
    })));
  expect(situationConstructionCount() - count).toBe(1);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(memory.strategyAllocation).toBeUndefined();
});
