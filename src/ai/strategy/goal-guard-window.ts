import type { DecisionFacts } from './decision';
import type { Effect, Objective } from './types';
import { STRATEGY_PARAMETERS } from './utility';

/** The obligation has an absolute end. Observation support rolls forward;
 * replanning must not move the goal's end forward on every think. */
export function goalGarrisonThroughTick(objective: Pick<Objective, 'sinceTick'>,
  effect: Extract<Effect, { kind: 'mining-established' }>): number {
  const through = effect.garrisonThroughTick ?? objective.sinceTick + STRATEGY_PARAMETERS.knownThreatHorizonTicks;
  if (!Number.isFinite(through) || through < 0) throw Error('Invalid garrison obligation window');
  return through;
}

export function retainGoalGuardWindows(current: DecisionFacts<Objective>, original = current): DecisionFacts<Objective> {
  return { ...current, effects: current.effects.map(effect => {
    if (effect.kind !== 'mining-established') return effect;
    const prior = original.effects.find(value => value.kind === 'mining-established' && value.mineId === effect.mineId);
    return { ...effect, garrisonThroughTick: effect.garrisonThroughTick
      ?? goalGarrisonThroughTick(original, prior?.kind === 'mining-established' ? prior : effect) };
  }) };
}
