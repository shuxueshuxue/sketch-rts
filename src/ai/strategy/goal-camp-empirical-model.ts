import { unitMover } from '../../shared/catalog';
import { SHOP_GOODS } from '../../shared/shop';
import type { GameSnapshot } from '../../shared/types';
import { forceFor } from '../policy/v7/creep';
import { assessAllocatedCampEngagement, targetCoveringTowers } from './allocated-force';
import { CAMP_ENCOUNTER_FEATURE_NAMES, campCompositionSignature, campEncounterFeatureVector, campModelMember,
  campWalkableFraction, type CampConsumableDecision } from './goal-camp-features';
import type { GoalCampBattleModel, GoalCampBattleQuote } from './goal-camp-quotation';
import type { GoalEstimate } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';
import { strategicTargetCamp } from './target-camp';

type Leaf = Readonly<{ zeroProbability: number | null; winProbability: number | null;
  positiveLossGold: readonly (readonly [number, number])[]; battleTicks: number | null; weight: number; rows: number }>;
type Node = Leaf | Readonly<{ feature: number; threshold: number; left: Node; right: Node }>;
export type CampEmpiricalTable = Readonly<{
  format: 'camp-gold-v2'; modelId: string; features: readonly string[]; trainingRows: number; sourceSha: string;
  tree: Node; support: Readonly<Record<string, readonly (readonly [number, number])[]>>;
}>;
export type CampConsumableUse = Readonly<{
  kind: Exclude<CampConsumableDecision, 'none'>; itemId: string; carrierId: string;
}>;
const pending = (code: string, ids: readonly string[]): Extract<GoalEstimate<never>, { state: 'pending' }> => ({
  state: 'pending', requestIds: [...new Set(ids)].sort(), reason: { code, factIds: [...new Set(ids)].sort(), values: {} },
});

/** A bounded empirical leaf, with separate win/zero-loss labels. Neither
 * missing support nor a censored label is converted into failure or P=1. */
export function predictEmpiricalCamp(table: CampEmpiricalTable, input: Readonly<{
  signature: string; features: readonly number[]; capitalGold: number; factIds: readonly string[];
}>): GoalEstimate<GoalCampBattleQuote> {
  const ids = [...new Set([...input.factIds, `camp-model:${table.sourceSha}`])].sort();
  if (table.format !== 'camp-gold-v2' || table.features.length !== CAMP_ENCOUNTER_FEATURE_NAMES.length || table.features.some((name, i) => name !== CAMP_ENCOUNTER_FEATURE_NAMES[i])
    || input.features.length !== table.features.length || !Number.isFinite(input.capitalGold) || input.capitalGold <= 0
    || input.features.some(value => !Number.isFinite(value))) return pending('camp-model-feature-schema-unavailable', ids);
  const bounds = table.support[input.signature];
  if (!bounds || bounds.length !== input.features.length) return pending('camp-model-composition-outside-support', ids);
  if (input.features.some((value, i) => { const [lo, hi] = bounds[i]!;
    return !Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi
      || value < lo - 1e-8 * Math.max(1, Math.abs(lo)) || value > hi + 1e-8 * Math.max(1, Math.abs(hi));
  })) return pending('camp-model-feature-outside-support', ids);
  let leaf = table.tree, depth = 0;
  while ('feature' in leaf) {
    if (++depth > 32 || !Number.isInteger(leaf.feature) || leaf.feature < 0 || leaf.feature >= input.features.length
      || !Number.isFinite(leaf.threshold)) return pending('camp-model-tree-unavailable', ids);
    leaf = input.features[leaf.feature]! <= leaf.threshold ? leaf.left : leaf.right;
  }
  const zero = leaf.zeroProbability, win = leaf.winProbability, duration = leaf.battleTicks;
  const positiveMass = leaf.positiveLossGold.reduce((sum, [mass]) => sum + mass, 0);
  if (zero === null || win === null || duration === null || !Number.isFinite(zero) || zero < 0 || zero > 1
    || !Number.isFinite(win) || win < 0 || win > 1 || !Number.isFinite(duration) || duration < 0
    || leaf.positiveLossGold.some(([mass, gold]) => !Number.isFinite(mass) || mass <= 0
      || !Number.isFinite(gold) || gold <= 0)
    || zero < 1 && Math.abs(positiveMass - 1) > 1e-8) return pending('camp-model-leaf-label-unavailable', ids);
  // Losing this cohort cannot destroy more unit replacement value than it
  // contains. Histograms stay in native gold, never re-discounted scores or
  // a mean casualty fraction multiplied by another cohort's capital.
  const positive = leaf.positiveLossGold.map(([probability, gold]) => ({ probability, lossGold: Math.min(input.capitalGold, gold) }));
  const expectedLossGold = (1 - zero) * positive.reduce((sum, item) => sum + item.probability * item.lossGold, 0);
  return { state: 'met', factIds: ids, value: { modelId: table.modelId, expectedLossGold, successProbability: win,
    battleTicks: Math.max(1, Math.ceil(duration)), requiredForce: 0, lossDistribution: { zeroProbability: zero, positive }, factIds: ids } };
}

/** Pure none/use quotation. The item branch is not an action declaration or
 * lease: callers still need the shared one-shot inventory/grant contract. */
export function quoteEmpiricalCampChoices(table: CampEmpiricalTable, input: Parameters<GoalCampBattleModel>[0],
  uses: readonly CampConsumableUse[] = []): readonly Readonly<{
    use: CampConsumableUse | null; battle: GoalEstimate<GoalCampBattleQuote>; consumableValueGold: number | null;
    workerCount: number; workerIncomeLossGold: null;
  }>[] {
  const snapshot = input.snapshot, selected = new Set(input.unitIds), owner = input.situation.owner;
  const ours = snapshot.units.filter(unit => selected.has(unit.id) && unit.owner === owner && unit.hp > 0);
  const camp = strategicTargetCamp(snapshot, input.target), ids = [...selected].sort();
  const invalid = !camp || ours.length !== selected.size || !ours.length
    || ours.some(unit => unitMover(unit.kind) !== 'land' || unit.deck || unit.cabin || unit.expiresTick !== undefined);
  const guardIds = new Set(camp?.creeps.map(unit => unit.id));
  const unmodelledItems = snapshot.items.some(item => guardIds.has(item.carrierId ?? ''));
  const unloading = snapshot.units.some(unit => unit.hp > 0 && strategyIsOpponent(snapshot, owner, unit.owner)
    && (unit.deck || unit.cabin) && snapshot.units.some(ship => ship.id === (unit.deck?.shipId ?? unit.cabin?.shipId) && ship.order.type === 'unload'));
  const choices: (CampConsumableUse | null)[] = [null, ...uses];
  return choices.map(use => {
    const item = use ? snapshot.items.find(item => item.id === use.itemId && item.kind === use.kind && item.carrierId === use.carrierId) : null;
    const value = use ? SHOP_GOODS.find(good => good.kind === use.kind)?.cost ?? null : 0;
    const workers = ours.filter(unit => unit.kind === 'worker').length;
    const fail = (code: string) => ({ use, battle: pending(code, ids), consumableValueGold: value, workerCount: workers, workerIncomeLossGold: null });
    if (invalid || !camp) return fail('camp-model-current-cohort-unavailable');
    if (use && (!item || (item.cooldownRemaining ?? 0) > 0 || !selected.has(use.carrierId) || value === null)) return fail('camp-model-consumable-unavailable');
    if (unmodelledItems) return fail('camp-model-neutral-item-policy-outside-support');
    if (unloading) return fail('combat-enemy-unload-binding-pending');
    const allies = ours.map(unit => campModelMember(snapshot, unit)), enemies = camp.creeps.map(unit => campModelMember(snapshot, unit));
    const consumable = use?.kind ?? 'none';
    const features = campEncounterFeatureVector(snapshot, { allies, enemies, consumable,
      campWalkableFraction: campWalkableFraction(snapshot, camp.center),
      stagingWalkableFraction: ours.reduce((sum, unit) => sum + campWalkableFraction(snapshot, unit), 0) / ours.length });
    let battle = predictEmpiricalCamp(table, { signature: campCompositionSignature(allies, enemies, consumable), features,
      capitalGold: allies.reduce((sum, member) => sum + member.nativeReplacementGold, 0),
      factIds: [...ids, ...guardIds, ...(use ? [use.itemId] : [])] });
    if (battle.state === 'met') {
      // The camp-only data does not license a mixed fight. Reuse the existing
      // published arrival/response facts, without charging its alpha estimate.
      const engagement = assessAllocatedCampEngagement({ ...input, windowTicks: battle.value.battleTicks });
      if (engagement.status !== 'known' || engagement.memberIds.some(id => !guardIds.has(id))
        || targetCoveringTowers(snapshot, owner, input.target, 'opponent').length) battle = pending('camp-model-third-party-contact-outside-support', [...ids, ...engagement.memberIds, ...engagement.unknownEnemyIds]);
      else battle = { ...battle, value: { ...battle.value, requiredForce: forceFor(camp) } };
    }
    return { use, battle, consumableValueGold: value, workerCount: workers, workerIncomeLossGold: null };
  });
}

export const createEmpiricalGoalCampBattleModel = (table: CampEmpiricalTable): GoalCampBattleModel => input =>
  quoteEmpiricalCampChoices(table, input)[0]!.battle;
