import { describe, expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { assessAllocatedCampBattle } from './allocated-force';
import { coarseGoalCampOptions, legacyGoalCampBattleModel, type GoalCampBattleModel } from './goal-camp-quotation';
import { FactWorkQueue } from './fact-work';
import { goalCampId, goalFact } from './goal-facts';
import { createGoalNavalCombatGrounding, type GoalNavalCombatGroundingPorts } from './goal-naval-combat-grounding';
import { goalNavalActionProvider } from './goal-naval-provider';
import type { GoalCandidates, GoalCombatOption, GoalPlanningContext } from './goal-planner-types';
import { landIdAt, regionIndex } from './regions';
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
    .unit('neutral', 'murlocPeon', 3000, 1000, { id: 'guard-a' })
    .unit('neutral', 'murlocPeon', 3070, 1000, { id: 'guard-b' }).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 96,
    cells: Array.from({ length: 128 * 96 }, (_, i) => i % 128 >= 48 && i % 128 <= 68 ? '~' : '.').join('') };
  const snapshot = snapshotGame(game); regionIndex(snapshot.map);
  const situation = evaluateSituation(snapshot, 'us', createAiPolicyMemory());
  const camp = neutralCampExposure(snapshot).camps[0]!, campId = goalCampId(camp.memberIds);
  const effect = goalFact({ kind: 'camp-cleared', campId });
  const cohort = snapshot.units.filter(unit => unit.owner === 'us').map(assessment => ({
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
    if (option.successProbability.state === 'met') expect(option.successProbability.value).toBeLessThan(1);
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
    // The legacy pure boundary also avoids the native enemy-unload projection.
    const enemy = { ...f.cohort[0]!.assessment, id: 'passenger', owner: 'foe', deck: { shipId: 'boat', x: 0, y: 0 } };
    const boat = { ...enemy, id: 'boat', deck: undefined, order: { type: 'unload' as const, x: 3000, y: 1000 } };
    expect(strict(() => legacyGoalCampBattleModel({ snapshot: { ...f.snapshot, units: [...f.snapshot.units, enemy, boat] },
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
});
