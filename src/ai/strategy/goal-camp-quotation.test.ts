import { describe, expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { assessAllocatedCampBattle } from './allocated-force';
import { coarseGoalCampOptions, calibratedAlphaGoalCampBattleModel, type GoalCampBattleModel } from './goal-camp-quotation';
import { FactWorkQueue } from './fact-work';
import { GOAL_CAMP_DEFAULT_MODEL_ID } from './goal-camp-default-model';
import { goalCampId, goalFact } from './goal-facts';
import { createGoalNavalCombatGrounding, type GoalNavalCombatGroundingPorts } from './goal-naval-combat-grounding';
import { goalNavalActionProvider } from './goal-naval-provider';
import type { GoalCandidates, GoalCombatOption, GoalPlanningContext } from './goal-planner-types';
import { landIdAt, regionIndex, seaIdAt } from './regions';
import { evaluateSituation } from './situation';

const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
function fixture(injured = false) {
  const game = sketchScene('coarse-conditional-camp-quote').map('bareDuel').replaceDefaults()
    .player('us', { team: 'us' }).player('foe', { team: 'foe' })
    .unit('us', 'footman', 800, 1000, { id: 'fighter-a', ...(injured ? { hp: 10 } : {}) })
    .unit('us', 'footman', 820, 1020, { id: 'fighter-b', ...(injured ? { hp: 10 } : {}) })
    .unit('us', 'footman', 840, 1000, { id: 'fighter-c', ...(injured ? { hp: 10 } : {}) })
    .unit('us', 'footman', 820, 980, { id: 'fighter-d', ...(injured ? { hp: 10 } : {}) })
    .worker('us', 700, 1000, { id: 'worker' })
    .unit('us', 'transport', 1800, 1000, { id: 'hull' })
    .unit('neutral', 'murlocPeon', 3000, 1000, { id: 'guard-a' })
    .unit('neutral', 'murlocPeon', 3070, 1000, { id: 'guard-b' }).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 96,
    cells: Array.from({ length: 128 * 96 }, (_, i) => i % 128 >= 48 && i % 128 <= 68 ? '~' : '.').join('') };
  const snapshot = snapshotGame(game); regionIndex(snapshot.map);
  const situation = evaluateSituation(snapshot, 'us', createAiPolicyMemory());
  const camp = neutralCampExposure(snapshot).camps[0]!, campId = goalCampId(camp.memberIds);
  const effect = goalFact({ kind: 'camp-cleared', campId });
  const cohort = snapshot.units.filter(unit => unit.owner === 'us' && unit.kind === 'footman').map(assessment => ({
    reference: { kind: 'existing' as const, entityId: assessment.id }, assessment }));
  const input = { snapshot, situation, effect, campId, cohort, byTick: 1800 };
  const unavailable = vi.fn((): never => { throw Error('coarse discovery requested exact work'); });
  const resolve: GoalNavalCombatGroundingPorts['resolveCohort'] = refs => ({ state: 'met', factIds: [],
    candidates: cohort.filter(member => refs.some(ref => ref.kind === 'existing' && ref.entityId === member.assessment.id)) });
  const ports: GoalNavalCombatGroundingPorts = { arrival: unavailable, landRoute: unavailable,
    readGroundPoint: unavailable, movementRisk: unavailable, cohortOptions: unavailable, resolveCohort: resolve };
  const base: GoalPlanningContext = { snapshot, situation, owner: 'us', tick: snapshot.tick,
    version: 'v9_knight', precision: 'coarse', readFact: unavailable };
  const factory = createGoalNavalCombatGrounding(base, ports);
  const context: GoalPlanningContext = { ...base, grounding: { buildSites: unavailable, productionOptions: unavailable,
    transportOptions: unavailable, resolveCohort: resolve, ...factory } };
  return { ...input, input, factory, context, unavailable };
}
function full(answer: GoalCandidates<GoalCombatOption>) {
  expect(answer.state).toBe('met'); if (answer.state !== 'met') throw Error(JSON.stringify(answer));
  const option = answer.candidates.find(option => option.cohort.length === 4);
  expect(option).toBeDefined(); return option!;
}

describe('conditional camp quotation before exact transport refinement', () => {
  it('quotes a remote actual group without requesting geometry and retains pool, staging and actual-arrival prerequisites', () => {
    const f = fixture(), before = JSON.stringify(f.snapshot), work = new FactWorkQueue(f.snapshot.tick, 0);
    expect(landIdAt(f.snapshot.map, f.cohort[0]!.assessment)).not.toBe(landIdAt(f.snapshot.map, f.snapshot.units.find(unit => unit.id === 'guard-a')!));
    const option = full(strict(() => f.factory.combatOptions!(f.effect)));
    expect(option.cost.state).toBe('met'); expect(option.successProbability.state).toBe('met');
    expect(option.cost.state === 'met' && option.cost.value[0]?.code).toBe(`camp-loss:${GOAL_CAMP_DEFAULT_MODEL_ID}`);
    const action = strict(() => goalNavalActionProvider.actionsFor(f.effect, f.context)).find(action =>
      Array.isArray(action.executor.parameters.cohort) && action.executor.parameters.cohort.length === 4)!;
    expect(action).toBeDefined(); expect(action.precision).toBe('coarse');
    expect(action.preconditions.map(fact => fact.predicate.kind)).toEqual(expect.arrayContaining(['force-available', 'force-at', 'camp-staging', 'route']));
    expect(action.effects.map(effect => effect.fact.predicate.kind)).toEqual(['camp-cleared']);
    expect(action.preconditions.some(fact => fact.predicate.kind === 'force-available' && fact.predicate.cohort?.length === 4)).toBe(true);
    expect(f.unavailable).not.toHaveBeenCalled(); strict(() => work.flush()); expect(work.receipt.used).toBe(0);
    expect(JSON.stringify(f.snapshot)).toBe(before);
  });

  it('uses the same native interim model at the conditional post, preserving wounds and actual deaths rather than returning a default zero', () => {
    for (const injured of [false, true]) {
      const f = fixture(injured), option = full(strict(() => coarseGoalCampOptions(f.input)));
      const ids = f.cohort.map(member => member.assessment.id), selected = new Set(ids);
      const assessed = { ...f.snapshot, units: f.snapshot.units.map(unit => selected.has(unit.id)
        ? { ...unit, ...option.target.point } : unit) };
      const camp = neutralCampExposure(f.snapshot).camps[0]!.camp;
      const clock = Math.ceil(Math.hypot(option.target.point.x - camp.center.x, option.target.point.y - camp.center.y)
        / Math.min(...f.cohort.map(member => member.assessment.speed)) * 20);
      const native = assessAllocatedCampBattle({ snapshot: assessed, situation: f.situation,
        target: { landId: option.target.landId!, point: camp.center }, unitIds: ids, battleStartTicks: clock });
      expect(native.status).toBe('known');
      expect(option.cost).toMatchObject({ state: 'met', value: [{ gold: native.attrition.expectedLossGold }] });
      expect(option.successProbability).toMatchObject({ state: 'met', value: native.successProbability });
      if (injured) expect(native.attrition.expectedLossGold).toBeGreaterThan(0);
      else expect(native.attrition.expectedLossGold).toBe(0);
    }
  });

  it('uses one replaceable model boundary for discovery and keeps unresolved opposition pending', () => {
    const f = fixture(), model: GoalCampBattleModel = () => ({ state: 'met', factIds: ['camp-model-v2'], value: {
      modelId: 'camp-mixture-fixture', expectedLossGold: 12, successProbability: .91, battleTicks: 80,
      requiredForce: 3, lossDistribution: { zeroProbability: .8, positive: [{ probability: 1, lossGold: 60 }] }, factIds: ['camp-model-v2'] } });
    const option = full(strict(() => coarseGoalCampOptions({ ...f.input, model })));
    expect(option.cost).toMatchObject({ state: 'met', value: [{ gold: 12, code: 'camp-loss:camp-mixture-fixture' }] });
    expect(option.successProbability).toMatchObject({ state: 'met', value: .91 });
    const unresolved = full(coarseGoalCampOptions({ ...f.input, model: () => ({ state: 'pending', requestIds: ['opposition-eta'],
      reason: { code: 'opposition-eta-pending', factIds: ['opposition'], values: {} } }) }));
    expect(unresolved.cost).toMatchObject({ state: 'pending', requestIds: ['opposition-eta'] });
    expect(unresolved.successProbability.state).toBe('pending');
    // The existing pure boundary also avoids the native enemy-unload projection.
    const enemy = { ...f.cohort[0]!.assessment, id: 'passenger', owner: 'foe', deck: { shipId: 'boat', x: 0, y: 0 } };
    const boat = { ...enemy, id: 'boat', deck: undefined, order: { type: 'unload' as const, x: 3000, y: 1000 } };
    expect(strict(() => calibratedAlphaGoalCampBattleModel({ snapshot: { ...f.snapshot, units: [...f.snapshot.units, enemy, boat] },
      situation: f.situation, target: option.target, unitIds: f.cohort.map(member => member.assessment.id), battleStartTicks: 0 })))
      .toMatchObject({ state: 'pending', reason: { code: 'combat-enemy-unload-binding-pending' } });
  });

  it('rejects substituted health, foreign or missing identities and honors the allocator exclusion pool in coarse discovery', () => {
    const f = fixture();
    expect(coarseGoalCampOptions({ ...f.input, cohort: [{ ...f.cohort[0]!, assessment: { ...f.cohort[0]!.assessment, hp: 999 } }] }).state).toBe('unmet');
    expect(coarseGoalCampOptions({ ...f.input, cohort: [{ ...f.cohort[0]!, reference: { kind: 'existing', entityId: 'guard-a' } }] }).state).toBe('unmet');
    const unavailable = f.unavailable;
    const factory = createGoalNavalCombatGrounding(f.context, { arrival: unavailable, landRoute: unavailable, resolveCohort: unavailable,
      cohortOptions: unavailable, allowedUnitIds: [f.cohort[0]!.assessment.id] });
    const answer = strict(() => factory.combatOptions!(f.effect));
    expect(answer.state).toBe('met'); if (answer.state !== 'met') throw Error();
    expect(answer.candidates.every(option => option.cohort.length === 1 && option.cohort[0]!.kind === 'existing'
      && option.cohort[0]!.entityId === f.cohort[0]!.assessment.id)).toBe(true);
    expect(unavailable).not.toHaveBeenCalled();
  });

  it('discovers the other ship-one location atoms using cached regions while preserving optimistic-only declarations', () => {
    const f = fixture(), before = JSON.stringify(f.snapshot), forbidden = f.unavailable;
    const target = { landId: landIdAt(f.snapshot.map, f.snapshot.units.find(unit => unit.id === 'guard-a')!)!, point: { x: 3035, y: 1000 } };
    const refs = f.cohort.map(member => member.reference), worker = { kind: 'existing' as const, entityId: 'worker' };
    const hull = f.snapshot.units.find(unit => unit.id === 'hull')!, transport = { kind: 'existing' as const, entityId: hull.id };
    const factory = createGoalNavalCombatGrounding(f.context, { arrival: forbidden, landRoute: forbidden,
      readGroundPoint: forbidden, movementRisk: forbidden, resolveCohort: forbidden });
    const resolve: GoalNavalCombatGroundingPorts['resolveCohort'] = refs => ({ state: 'met', factIds: [], candidates: refs.flatMap(reference => {
      const actor = reference.kind === 'existing' && f.snapshot.units.find(unit => unit.id === reference.entityId);
      return actor ? [{ reference, assessment: actor }] : [];
    }) });
    const context: GoalPlanningContext = { ...f.context, grounding: { ...f.context.grounding!, ...factory, resolveCohort: resolve } };
    const force = goalFact({ kind: 'force-at', at: target, cohort: refs, metric: 'camp-force', campId: f.campId, minimum: 1, byTick: 1800 });
    const pool = goalFact({ kind: 'force-available', at: target, cohort: refs, metric: 'combat-rating', minimum: 1, byTick: 1800 });
    const engineer = goalFact({ kind: 'worker-at', at: target, worker, count: 1, byTick: 1800 });
    const garrison = goalFact({ kind: 'garrison-ready', mineId: 'prospective-mine', at: { ...target, entityId: 'prospective-mine' } });
    const atHull = goalFact({ kind: 'transport-at', transport, at: { seaId: seaIdAt(f.snapshot.map, hull)!, point: { x: 1800, y: 1500 } }, tolerance: 50, byTick: 1800 });
    for (const effect of [force, pool, engineer, garrison, atHull]) {
      const answer = strict(() => factory.combatOptions!(effect));
      expect(answer.state).toBe('met'); if (answer.state !== 'met') throw Error(JSON.stringify(answer));
      expect(answer.candidates.length).toBeGreaterThan(0);
      expect(answer.candidates.every(option => option.duration.state === 'met' && option.cost.state === 'met'
        && option.successProbability.state === 'met')).toBe(true);
      if (effect === force || effect === garrison || effect === atHull) {
        const actions = strict(() => goalNavalActionProvider.actionsFor(effect, context));
        expect(actions.length).toBeGreaterThan(0);
        expect(actions.every(action => action.precision === 'coarse')).toBe(true);
        if (effect === garrison) expect(actions.every(action => action.kind === 'hold-position'
          && action.preconditions.some(fact => fact.predicate.kind === 'hall-complete')
          && action.preconditions.some(fact => fact.predicate.kind === 'site-safe'))).toBe(true);
      }
    }
    expect(forbidden).not.toHaveBeenCalled(); expect(JSON.stringify(f.snapshot)).toBe(before);
  });
});
