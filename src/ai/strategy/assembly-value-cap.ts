import { GOLD_MINE_RULES } from '../../shared/mining';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot } from '../../shared/types';
import type { AllocationReason } from './allocation-types';
import type { DecisionFacts } from './decision';
import type { Objective, ValuationWindow } from './types';
import { discountedFlow, valuationWindow } from './utility';

export type AssemblyContinuationCap = Readonly<{ status: 'known'; targetId: string; gold: number;
  window: ValuationWindow; components: readonly Readonly<{ code: string; valueGold: number; factIds: readonly string[] }>[];
  reason: AllocationReason }> | Readonly<{ status: 'unknown'; reason: AllocationReason }>;

/** Formal conquest's gross payoff cannot exceed immediate, untaxed native
 * mine-admission capacity with P=1 and no clearing/build/training costs.
 * This is a cap on valueConquestContinuation's positive cash flows, not a
 * reconstructed incumbent plan, a fill probability or an executable quote. */
export function assemblyContinuationValueCap(snapshot: GameSnapshot, objective: DecisionFacts<Objective>, window: ValuationWindow): AssemblyContinuationCap {
  const targetId = objective.target.entityId;
  const unknown = (code: string): AssemblyContinuationCap => ({ status: 'unknown', reason: { code,
    factIds: targetId ? [objective.id, targetId] : [objective.id], values: {} } });
  if (objective.kind !== 'ConquerIsland' || !targetId || !objective.effects.length
    || objective.effects.some(effect => effect.kind !== 'mining-established' || effect.mineId !== targetId))
    return unknown('assembly-continuation-terminal-value-unquoted');
  const mine = snapshot.resources.find(resource => resource.id === targetId && resource.kind === 'goldMine');
  if (!mine || !Number.isFinite(mine.amount) || mine.amount < 0
    || !Number.isFinite(objective.utility.persistenceBonus) || objective.utility.persistenceBonus < 0)
    return unknown('assembly-continuation-value-unknown');
  try { valuationWindow(window.taskTicks, { phase: 'gross', window }); }
  catch { return unknown('assembly-continuation-window-invalid'); }
  const capRate = GOLD_MINE_RULES.goldPerTrip / (GOLD_MINE_RULES.entrySeconds * SIM_TICKS_PER_SECOND);
  const income = discountedFlow({ goldPerTick: capRate, remainingGold: mine.amount, startsInTicks: 0, window });
  const components = [
    { code: 'formal-mining-native-admission-value-cap', valueGold: income, factIds: [targetId] },
    { code: 'formal-conquest-persistence-value-cap', valueGold: objective.utility.persistenceBonus, factIds: [objective.id] },
  ];
  const gold = components.reduce((sum, component) => sum + component.valueGold, 0);
  return { status: 'known', targetId, gold, window, components, reason: {
    code: 'formal-conquest-full-capacity-continuation-value-cap', factIds: [objective.id, targetId],
    values: { remainingOre: mine.amount, maximumIncomeGoldPerTick: capRate, probabilityUpper: 1,
      incomeUpperGold: income, persistenceUpperGold: objective.utility.persistenceBonus, valueCapGold: gold } } };
}
