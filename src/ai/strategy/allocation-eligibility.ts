import type { GameSnapshot } from '../../shared/types';
import type { StrategyAllocationMemory } from './allocation-types';
import type { DecisionFacts } from './decision';
import type { Situation } from './types';

/** One free-pool definition for grants and other-army response forecasts.
 * Observed proposals stay in Situation; only actual authority blocks a unit.
 * An advancing unpriced task remains unavailable until its receipt is adopted. */
export function allocationResponseCandidates(snapshot: GameSnapshot, situation: DecisionFacts<Situation>, memory: StrategyAllocationMemory): string[] {
  const actors = new Map(snapshot.units.map(unit => [unit.id, unit]));
  return situation.units.filter(unit => {
    const actor = actors.get(unit.id);
    return unit.owner === situation.owner && unit.hp > 0 && !memory.leases[`unit:${unit.id}`] && actor
      && (unit.commitments.length === 0 || actor.order.type === 'idle' && !actor.deck && !actor.cabin);
  }).map(unit => unit.id).sort();
}
