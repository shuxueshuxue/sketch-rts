import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { assessGoalCombatMovementRisk, goalCombatMovementRiskId } from './goal-combat-movement-risk';
import { goalFact } from './goal-facts';
import type { GoalCombatMovementRequest } from './goal-naval-combat-grounding';
import type { GoalEstimate } from './goal-planner-types';
import { evaluateSituation } from './situation';
const known = <T>(value: T): GoalEstimate<T> => ({ state: 'met', value, factIds: ['published'] });
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
function scene() {
  return sketchScene('observed-march-risk').map('bareDuel').replaceDefaults().player('us', { team: 'us' })
    .player('foe', { team: 'foe' }).unit('us', 'footman', 1000, 1000, { id: 'marcher' });
}
function input(snapshot: GameSnapshot, ticks = 40, to = { x: 1100, y: 1000 }) {
  const situation = evaluateSituation(snapshot, 'us', createAiPolicyMemory()), unit = snapshot.units.find(u => u.id === 'marcher')!;
  const reference = { kind: 'existing' as const, entityId: unit.id }, from = { landId: 'land:1' as const, point: { x: unit.x, y: unit.y } }, target = { landId: 'land:1' as const, point: to };
  const effect = goalFact({ kind: 'force-at', at: target, minimum: 1, byTick: snapshot.tick + 900, metric: 'combat-rating', cohort: [reference] });
  const route = goalFact({ kind: 'route', mover: 'land', from, to: target, actor: reference });
  const request: GoalCombatMovementRequest = { effect, cohort: [{ reference, assessment: unit }], from, target, arrivalTicks: known(ticks), throughTick: snapshot.tick + 900,
    routes: [{ fact: route, state: 'met', observedTick: snapshot.tick, revision: 'actual-route-1', evidence: [],
      reason: { code: 'published', factIds: [route.id], values: {} }, route: { points: [to], distance: Math.hypot(to.x - unit.x, to.y - unit.y), ticks } }] };
  return { snapshot, situation, request };
}
describe('published march no-exposure proof', () => {
  it('proves an observed clear route without navigation, mutation, a new Situation or probabilistic defaults', () => {
    const f = input(snapshotGame(scene().unit('foe', 'footman', 3500, 3500, { id: 'far' }).build().createGame())), before = JSON.stringify(f);
    expect(strict(() => assessGoalCombatMovementRisk(f))).toMatchObject({ state: 'met', value: { expectedLossGold: 0, survivalProbability: 1 } });
    expect(JSON.stringify(f)).toBe(before); expect(assessGoalCombatMovementRisk(JSON.parse(before))).toEqual(assessGoalCombatMovementRisk(f));
  });
  it('covers the whole march window rather than just the initial enemy attack disk', () => {
    const f = input(snapshotGame(scene().unit('foe', 'footman', 1700, 1000, { id: 'approaching' }).build().createGame()), 200);
    expect(strict(() => assessGoalCombatMovementRisk(f))).toMatchObject({ state: 'pending', reason: { code: 'movement-observed-exposure-unquoted', factIds: expect.arrayContaining(['approaching']) } });
  });
  it('does not forget returning camp home/leash or unfinished hostile tower potential', () => {
    const camp = input(snapshotGame(scene().unit('neutral', 'ogreWarrior', 1600, 1000, { id: 'guard', order: { type: 'move', x: 1600, y: 1000 } }).build().createGame()));
    expect(strict(() => assessGoalCombatMovementRisk(camp)).state).toBe('pending');
    const tower = input(snapshotGame(scene().building('foe', 'defenseTower', 1300, 1000, { id: 'tower', complete: false }).build().createGame()));
    expect(strict(() => assessGoalCombatMovementRisk(tower))).toMatchObject({ state: 'pending', reason: { factIds: expect.arrayContaining(['tower']) } });
  });
  it('keeps exact route requests pending and rejects unpublished, stale or substituted facts', () => {
    const f = input(snapshotGame(scene().build().createGame())), row = f.request.routes[0]!;
    const unresolved = { ...f, request: { ...f.request, routes: [{ ...row, state: 'pending' as const, requestId: 'shared-route-42', requestedTick: f.snapshot.tick }] } };
    expect(strict(() => assessGoalCombatMovementRisk(unresolved))).toMatchObject({ state: 'pending', requestIds: ['shared-route-42'] });
    expect(assessGoalCombatMovementRisk({ ...f, request: { ...f.request, routes: [{ ...row, observedTick: -1 }] } }).state).toBe('pending');
    expect(assessGoalCombatMovementRisk({ ...f, request: { ...f.request, cohort: [{ ...f.request.cohort[0]!, assessment: { ...f.request.cohort[0]!.assessment, hp: 999 } }] } }).state).toBe('pending');
  });
  it('reuses only a current exact request-bound published existing model and never turns exposure into P=1', () => {
    const f = input(snapshotGame(scene().unit('foe', 'footman', 1200, 1000, { id: 'exposed' }).build().createGame()));
    const risk = known({ expectedLossGold: 23, survivalProbability: .7 }), publishedRisk = { epoch: f.snapshot.tick, requestId: goalCombatMovementRiskId(f.request), risk };
    expect(strict(() => assessGoalCombatMovementRisk({ ...f, publishedRisk }))).toEqual(risk);
    expect(assessGoalCombatMovementRisk({ ...f, publishedRisk: { ...publishedRisk, epoch: -1 } }).state).toBe('pending');
    expect(assessGoalCombatMovementRisk({ ...f, request: { ...f.request, throughTick: 899 }, publishedRisk }).state).toBe('pending');
  });
  it('bounds item splash/chain reach and preserves genuine zero elapsed movement', () => {
    const f = input(snapshotGame(scene().unit('foe', 'footman', 1850, 1000, { id: 'caster' })
      .item('rod', 'lightningRod', 0, 0, { carrierId: 'caster' }).build().createGame()), 100);
    expect(strict(() => assessGoalCombatMovementRisk(f)).state).toBe('pending');
    const now = input(f.snapshot, 0, { x: 1000, y: 1000 });
    expect(strict(() => assessGoalCombatMovementRisk(now))).toMatchObject({ state: 'met', value: { expectedLossGold: 0, survivalProbability: 1 } });
  });
});
