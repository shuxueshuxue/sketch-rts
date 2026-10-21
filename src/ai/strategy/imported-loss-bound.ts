import type { DecisionFacts } from './decision';
import type { ImportedLossUpperBound, Objective, Situation, ValuationWindow } from './types';
import { discountedFlow } from './utility';

/** Migration envelope, never a reconstructed old plan. The current mining
 * utility can earn at most immediate, fully staffed, untaxed mining income
 * with probability one, plus its known persistence bonus. Travel, clearing,
 * recruitment, asset loss and opportunity costs only reduce that value.
 * Using the requester's entire window deliberately overprices displacement;
 * it does not assert that the old task can actually achieve this production.
 * Other terminal effects have no proven envelope here and remain unknown. */
export function importedMiningLossUpperBound(situation: DecisionFacts<Situation>,
  objectives: readonly DecisionFacts<Objective>[], targetId: string, window: ValuationWindow): ImportedLossUpperBound | null {
  const mine = situation.assets.find(asset => asset.id === targetId && asset.kind === 'mine');
  const goals = objectives.filter(objective => objective.target.entityId === targetId
    && ['ConquerIsland', 'ExpandLand'].includes(objective.kind)
    && objective.effects.length > 0 && objective.effects.every(effect => effect.kind === 'mining-established' && effect.mineId === targetId));
  if (!mine?.miningCapacity || !goals.length) return null;
  const persistence = Math.max(...goals.map(goal => goal.utility.persistenceBonus));
  if (!Number.isFinite(persistence) || persistence < 0) return null;
  const income = discountedFlow({ goldPerTick: mine.miningCapacity.goldPerTickCap,
    remainingGold: mine.remainingGold, startsInTicks: 0, window });
  const components = [{ code: 'immediate-full-capacity-mining-envelope', valueGold: income, factIds: [targetId] },
    { code: 'maximum-target-persistence', valueGold: persistence, factIds: goals.map(goal => goal.id).sort() }];
  return { targetId, gold: income + persistence, window, components };
}
