import { unitMover } from '../../shared/catalog';
import { isOpenGround } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, Unit } from '../../shared/types';
import { CREEP_STAGING_TURNS, stagingClear, stagingPoint } from '../policy/v7/creep';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { assessAllocatedCampBattle, assessAllocatedForce } from './allocated-force';
import type { DecisionFacts } from './decision';
import { goalFact, goalValueKey, resolveGoalCamp } from './goal-facts';
import type { GoalCandidates, GoalCohortMember, GoalCombatOption, GoalEstimate, GoalFact } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';
import { landIdAt } from './regions';
import { goalCampStagingOutsideAlert } from './goal-camp-staging-geometry';
import type { Situation, Target } from './types';

/** One replaceable camp-only model boundary. Search and exact assessment use
 * the same output currency; neither adds a conservative loss margin. The
 * existing model has no fitted loss distribution, so it explicitly returns null
 * until the separate camp calibration supplies one. */
export type GoalCampBattleQuote = Readonly<{
  modelId: string; expectedLossGold: number; successProbability: number;
  battleTicks: number; requiredForce: number;
  lossDistribution: Readonly<{ zeroProbability: number;
    positive: readonly Readonly<{ probability: number; lossGold: number }>[] }> | null;
  factIds: readonly string[];
}>;
export type GoalCampBattleModel = (input: Readonly<{
  snapshot: GameSnapshot; situation: DecisionFacts<Situation>; target: Target;
  unitIds: readonly string[]; battleStartTicks: number;
}>) => GoalEstimate<GoalCampBattleQuote>;
const sorted = (ids: readonly string[]) => [...new Set(ids)].sort();
const known = <T>(value: T, factIds: readonly string[]): GoalEstimate<T> => ({ state: 'met', value, factIds: sorted(factIds) });

/** Existing calibrated model, retained as an explicitly named interim model.
 * No alpha, micro assumption or probability is recalibrated here. */
export const calibratedAlphaGoalCampBattleModel: GoalCampBattleModel = input => {
  // The shared assessor's old enemy-unload projection is a native path query.
  // Its affiliation must be provided by the owner source before invoking it.
  const unloading = input.snapshot.units.filter(unit => unit.hp > 0
    && strategyIsOpponent(input.snapshot, input.situation.owner, unit.owner) && (unit.deck || unit.cabin)
    && input.snapshot.units.some(ship => ship.id === (unit.deck?.shipId ?? unit.cabin?.shipId) && ship.order.type === 'unload'));
  if (unloading.length) return { state: 'pending', requestIds: unloading.map(unit => unit.id).sort(),
    reason: { code: 'combat-enemy-unload-binding-pending', factIds: unloading.map(unit => unit.id).sort(), values: {} } };
  const battle = assessAllocatedCampBattle(input);
  const ids = sorted([...input.unitIds, ...battle.engagement.memberIds, ...battle.coveringTowerIds]);
  if (battle.status !== 'known') return { state: 'pending', requestIds: sorted(battle.engagement.unknownEnemyIds.length
    ? battle.engagement.unknownEnemyIds : ids), reason: { code: battle.reasonCode, factIds: ids, values: {} } };
  return known({ modelId: 'casualty-alpha-0.19', expectedLossGold: battle.attrition.expectedLossGold,
    successProbability: battle.successProbability!, battleTicks: battle.durationTicks,
    requiredForce: battle.requiredForce!, lossDistribution: null, factIds: ids }, ids);
};

/** Coarse search quotes the attack conditional on this exact group reaching a
 * native staging candidate. It does not quote a voyage, assert arrival or read
 * geometry facts. The full pool/force-at/staging/route conditions remain in the
 * declaration for exact refinement. Literal candidates use the native staging
 * turns; even their legality is not promoted into a published staging proof. */
export function coarseGoalCampOptions(input: Readonly<{
  snapshot: GameSnapshot; situation: DecisionFacts<Situation>; effect: GoalFact;
  campId: string; cohort: readonly GoalCohortMember[]; byTick: number;
  model?: GoalCampBattleModel;
}>): GoalCandidates<GoalCombatOption> {
  const { snapshot, situation, campId, cohort, effect } = input;
  const reject = (code: string): GoalCandidates<GoalCombatOption> => ({ state: 'unmet',
    reason: { code, factIds: [effect.id, campId], values: {} } });
  if (!cohort.length || !Number.isFinite(input.byTick) || input.byTick < snapshot.tick
    || situation.tick !== snapshot.tick) return reject('combat-coarse-cohort-or-epoch-invalid');
  const actual = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const group: Unit[] = [];
  for (const member of cohort) {
    const unit = member.reference.kind === 'existing' ? actual.get(member.reference.entityId) : undefined;
    if (!unit || unit.owner !== situation.owner || unit.hp <= 0 || unit.expiresTick !== undefined
      || unit.kind === 'worker' || unit.attackDamage <= 0 || unitMover(unit.kind) !== 'land'
      || goalValueKey(unit) !== goalValueKey(member.assessment)) return reject('combat-coarse-actual-cohort-required');
    if (!group.some(previous => previous.id === unit.id)) group.push(unit);
  }
  const resolved = resolveGoalCamp(snapshot, campId);
  if (resolved.status !== 'present') return reject(resolved.status === 'cleared' ? 'combat-camp-already-cleared' : 'combat-camp-binding-invalid');
  const camp = resolved.exposure.camp, landId = landIdAt(snapshot.map, camp.center);
  if (!landId) return reject('combat-camp-region-invalid');
  const from = { x: group.reduce((sum, unit) => sum + unit.x, 0) / group.length,
    y: group.reduce((sum, unit) => sum + unit.y, 0) / group.length };
  const all = neutralCampExposure(snapshot).camps.map(row => row.camp);
  const point = CREEP_STAGING_TURNS.map(turn => stagingPoint(camp, from, turn)).find(point =>
    isOpenGround(snapshot.map, point.x, point.y) && landIdAt(snapshot.map, point) === landId && stagingClear(point, all, camp)
      && goalCampStagingOutsideAlert(resolved.exposure, point, group));
  if (!point) return { state: 'pending', requestIds: [`coarse-camp-staging:${campId}`],
    reason: { code: 'combat-coarse-staging-refinement-required', factIds: [effect.id, campId], values: {} } };
  const staging: Target = { landId, point }, target: Target = { landId, point: camp.center };
  const refs = group.map(unit => ({ kind: 'existing' as const, entityId: unit.id }));
  // A literal direct distance is a declared optimistic search time, never a
  // reachable road or a FactWork result. Exact refinement replaces it.
  const contactTicks = Math.ceil(Math.hypot(point.x - camp.center.x, point.y - camp.center.y)
    / Math.max(1, Math.min(...group.map(unit => unit.speed))) * SIM_TICKS_PER_SECOND);
  const copies = group.map(unit => ({ ...unit, x: point.x, y: point.y, deck: undefined, cabin: undefined }));
  const ids = new Set(group.map(unit => unit.id));
  const assessed = { ...snapshot, units: [...snapshot.units.filter(unit => !ids.has(unit.id)), ...copies] };
  const quote = (input.model ?? calibratedAlphaGoalCampBattleModel)({ snapshot: assessed, situation, target,
    unitIds: group.map(unit => unit.id), battleStartTicks: contactTicks });
  const pool = goalFact({ kind: 'force-available', at: staging, metric: 'combat-rating', minimum: 0,
    cohort: refs, byTick: input.byTick });
  const post = goalFact({ kind: 'camp-staging', campId, at: staging, cohort: refs });
  const routes = refs.map(actor => goalFact({ kind: 'route', mover: 'land', actor, from: staging, to: target }));
  const facts = sorted([effect.id, campId, pool.id, post.id, ...routes.map(fact => fact.id),
    ...(quote.state === 'met' ? quote.factIds : quote.reason.factIds)]);
  return { state: 'met', factIds: facts, candidates: [{
    id: `coarse-camp:${goalValueKey([effect.id, campId, refs, staging])}`, target: staging, from: staging, campId,
    cohort: refs, requiredForce: quote.state === 'met' ? quote.value.requiredForce
      : assessAllocatedForce(situation.owner, [], { metric: 'camp-force', camp }).requiredForce,
    byTick: input.byTick,
    duration: quote.state === 'met' ? known(contactTicks + quote.value.battleTicks, facts) : quote,
    cost: quote.state === 'met' ? known([{ code: `camp-loss:${quote.value.modelId}`,
      gold: quote.value.expectedLossGold, factIds: facts }], facts) : quote,
    successProbability: quote.state === 'met' ? known(quote.value.successProbability, facts) : quote,
    preconditions: [pool, post, ...routes], factIds: facts,
  }] };
}
