import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { assessGoalCombatMovementRisk, goalCombatMovementRiskId } from './goal-combat-movement-risk';
import { goalCampId, goalFact } from './goal-facts';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
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
  it('keeps the original near t990/t1005 published gathering roads out of a dormant camp pursuit disk', () => {
    const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-camp-march-near-488.json.gz', import.meta.url))).toString()) as {
      cases: { snapshot: GameSnapshot; situation: { tick: number; owner: string; horizonTicks: number }; request: GoalCombatMovementRequest;
        plannedCampIds: string[]; originalRisk: GoalEstimate<unknown>; provenance: { tick: number }; publishedFieldProgress: { readyTick: number; work: number } }[];
    };
    expect(fixture.cases.map(row => row.provenance.tick)).toEqual([990, 1005]);
    for (const row of fixture.cases) {
      const before = JSON.stringify(row);
      expect(row.originalRisk).toMatchObject({ state: 'pending', reason: { code: 'movement-observed-exposure-unquoted' } });
      expect(row.publishedFieldProgress.readyTick).toBeLessThan(row.snapshot.tick);
      expect(row.publishedFieldProgress.work).toBe(2948);
      expect(strict(() => assessGoalCombatMovementRisk(row))).toMatchObject({ state: 'met', value: { expectedLossGold: 0, survivalProbability: 1 } });
      const planned = { ...row, request: { ...row.request, plannedCampIds: row.plannedCampIds } };
      expect(strict(() => assessGoalCombatMovementRisk(planned))).toMatchObject({ state: 'met', value: { expectedLossGold: 0, survivalProbability: 1 },
        factIds: expect.arrayContaining(row.plannedCampIds) });
      expect(goalCombatMovementRiskId(row.request)).not.toBe(goalCombatMovementRiskId(planned.request));
      expect(JSON.stringify(row)).toBe(before);
    }
  });
  it('charges only bystander camps to movement and retains all non-camp danger', () => {
    const snapshot = snapshotGame(scene().unit('neutral', 'murlocPeon', 1250, 1000, { id: 'planned-guard' })
      .unit('neutral', 'murlocPeon', 1800, 1000, { id: 'bystander', order: { type: 'attack', targetId: 'marcher' } }).build().createGame());
    const f = input(snapshot), camp = neutralCampExposure(snapshot).camps.find(camp => camp.memberIds.includes('planned-guard'))!;
    const campId = goalCampId(camp.memberIds), request = { ...f.request, plannedCampIds: [campId] };
    expect(strict(() => assessGoalCombatMovementRisk({ ...f, request }))).toMatchObject({ state: 'pending', reason: {
      code: 'movement-observed-exposure-unquoted', factIds: expect.arrayContaining(['bystander']) } });
    const withoutBystander = { ...snapshot, units: snapshot.units.filter(unit => unit.id !== 'bystander') };
    const sole = input(withoutBystander);
    expect(strict(() => assessGoalCombatMovementRisk(sole)).state).toBe('pending');
    expect(strict(() => assessGoalCombatMovementRisk({ ...sole, request: { ...sole.request, plannedCampIds: [campId] } }))).toMatchObject({ state: 'met' });
    const hostile = { ...withoutBystander, units: [...withoutBystander.units, { ...snapshot.units.find(unit => unit.id === 'bystander')!, owner: 'foe' }] };
    const exposed = input(hostile, 200);
    expect(strict(() => assessGoalCombatMovementRisk({ ...exposed, request: { ...exposed.request, plannedCampIds: [campId] } }))).toMatchObject({ state: 'pending', reason: {
      factIds: expect.arrayContaining(['bystander']) } });
    const left = { ...sole.request, plannedCampIds: ['b', campId, 'b'] }, right = { ...sole.request, plannedCampIds: [campId, 'b'] };
    expect(goalCombatMovementRiskId(left)).toBe(goalCombatMovementRiskId(right));
  });
  it('uses the whole road and inclusive native alert boundary for dormant guards, not the 650 leash', () => {
    const prepare = (x: number) => input(snapshotGame(scene().unit('neutral', 'murlocPeon', x, 1000, { id: 'guard' }).build().createGame()));
    expect(strict(() => assessGoalCombatMovementRisk(prepare(1250))).state).toBe('pending');
    expect(strict(() => assessGoalCombatMovementRisk(prepare(1250.01))).state).toBe('met');
    const longWeapon = prepare(1500);
    longWeapon.snapshot.units.find(unit => unit.id === 'guard')!.attackRange = 900;
    expect(strict(() => assessGoalCombatMovementRisk(longWeapon)).state).toBe('met');
    const crossed = input(prepare(1500).snapshot, 400, { x: 2000, y: 1000 });
    expect(strict(() => assessGoalCombatMovementRisk(crossed))).toMatchObject({ state: 'pending', reason: { factIds: expect.arrayContaining(['guard']) } });
  });
  it('retains activated, returning, incoming-damage and carried-item exposure outside alert range', () => {
    for (const order of [{ type: 'attack' as const, targetId: 'marcher' }, { type: 'move' as const, x: 1600, y: 1000 }]) {
      const f = input(snapshotGame(scene().unit('neutral', 'murlocPeon', 1600, 1000, { id: 'guard', order }).build().createGame()));
      expect(strict(() => assessGoalCombatMovementRisk(f))).toMatchObject({ state: 'pending', reason: { factIds: expect.arrayContaining(['guard']) } });
    }
    const caster = input(snapshotGame(scene().unit('neutral', 'murlocPeon', 1320, 1000, { id: 'guard' })
      .item('camp-rod', 'lightningRod', 0, 0, { carrierId: 'guard' }).build().createGame()), 100);
    expect(strict(() => assessGoalCombatMovementRisk(caster)).state).toBe('pending');
    const poisoned = input(snapshotGame(scene().unit('neutral', 'murlocPeon', 1600, 1000, { id: 'guard' }).build().createGame()));
    poisoned.snapshot.units.find(unit => unit.id === 'guard')!.effects.push({ type: 'poison', remaining: 30 });
    expect(strict(() => assessGoalCombatMovementRisk(poisoned)).state).toBe('pending');
    const pendingAttack = input(snapshotGame(scene().unit('us', 'archer', 1500, 1100, { id: 'attacker', order: { type: 'attack', targetId: 'guard' } })
      .unit('neutral', 'murlocPeon', 1600, 1000, { id: 'guard' }).build().createGame()));
    expect(strict(() => assessGoalCombatMovementRisk(pendingAttack)).state).toBe('pending');
  });
  it('leaves named camp contact to the calibrated battle but retains every third-party exposure and exact staging condition', () => {
    const prepare = (enemy: boolean) => {
      let builder = scene().unit('neutral', 'ogreWarrior', 1600, 1000, { id: 'target-guard' });
      if (enemy) builder = builder.unit('foe', 'footman', 1250, 1000, { id: 'third-party' });
      const f = input(snapshotGame(builder.build().createGame()), 40, { x: 1600, y: 1000 });
      const camp = neutralCampExposure(f.snapshot).camps[0]!, campId = goalCampId(camp.memberIds);
      const from = { landId: 'land:1' as const, point: { x: 1100, y: 1000 } };
      const cohort = f.request.cohort.map(member => ({ ...member, assessment: { ...member.assessment,
        x: from.point.x, y: from.point.y, deck: undefined, cabin: undefined } }));
      const stagingFact = goalFact({ kind: 'camp-staging', campId, at: from, cohort: cohort.map(member => member.reference) });
      const route = goalFact({ kind: 'route', mover: 'land', actor: cohort[0]!.reference, from, to: f.request.target });
      const request: GoalCombatMovementRequest = { ...f.request, effect: goalFact({ kind: 'camp-cleared', campId }), from, cohort,
        routes: [{ ...f.request.routes[0]!, fact: route, route: { points: [f.request.target.point], distance: 500, ticks: 40 } }],
        campContact: { campId, stagingFact } };
      return { ...f, request };
    };
    const f = prepare(false), before = JSON.stringify(f), { campContact: _contact, ...ordinary } = f.request;
    expect(strict(() => assessGoalCombatMovementRisk({ ...f, request: ordinary }))).toMatchObject({ state: 'pending', reason: { code: 'movement-current-cohort-binding-pending' } });
    expect(strict(() => assessGoalCombatMovementRisk(f))).toMatchObject({ state: 'met', value: { expectedLossGold: 0, survivalProbability: 1 },
      factIds: expect.arrayContaining([f.request.campContact!.campId, f.request.campContact!.stagingFact.id]) });
    expect(goalCombatMovementRiskId(f.request)).not.toBe(goalCombatMovementRiskId(ordinary));
    const injured = { ...f, request: { ...f.request, cohort: f.request.cohort.map(member => ({ ...member, assessment: { ...member.assessment, hp: 999 } })) } };
    expect(strict(() => assessGoalCombatMovementRisk(injured))).toMatchObject({ state: 'pending', reason: { code: 'movement-camp-contact-cohort-pending' } });
    expect(strict(() => assessGoalCombatMovementRisk(prepare(true)))).toMatchObject({ state: 'pending', reason: {
      code: 'movement-observed-exposure-unquoted', factIds: expect.arrayContaining(['third-party']) } });
    expect(JSON.stringify(f)).toBe(before);
  });
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
