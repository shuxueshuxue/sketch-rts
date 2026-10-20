import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Utility } from './types';
import { copiedEvidenceProjection, deferredEvidence, deferredRecord, projectedCopy, valueReader } from './explanations';

/** A shared gold-equivalent scale for every objective family; never map-specific. */
export const STRATEGY_PARAMETERS = Object.freeze({
  utilityHorizonTicks: 120 * SIM_TICKS_PER_SECOND,
  threatHorizonTicks: 45 * SIM_TICKS_PER_SECOND,
  goldPerFieldStrength: 100,
  minimumStayTicks: 15 * SIM_TICKS_PER_SECOND,
  challengerThinks: 3,
  persistenceBenefitShare: .1,
  maximumPersistenceGold: 50,
});

function finite(value: number, name: string, minimum = -Infinity) {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid strategy ${name}: ${value}`);
  return value;
}

/** This is a stated heuristic, not a measured probability of winning a match.
 * Both inputs must use the same currency (field strength, or camp force).
 * Scaling before squaring keeps even very large finite strengths finite. */
export function forceSuccessProbability(availableStrength: number, requiredStrength: number): number {
  finite(availableStrength, 'available strength', 0);
  finite(requiredStrength, 'required strength', 0);
  if (!availableStrength) return 0;
  const scale = Math.max(availableStrength, requiredStrength);
  const available = availableStrength / scale, required = requiredStrength / scale;
  return available * available / (available * available + required * required);
}

/** Discount a benefit by time to its effect, using the common evaluation window. */
export function discountGold(value: number, etaTicks: number): number {
  finite(value, 'benefit');
  finite(etaTicks, 'effect ETA', 0);
  return value / (1 + etaTicks / STRATEGY_PARAMETERS.utilityHorizonTicks);
}

/** Cost of occupying field strength for a duration, regardless of success. */
export function forceTimeGold(strength: number, occupiedTicks: number): number {
  finite(strength, 'occupied field strength', 0);
  finite(occupiedTicks, 'occupied duration', 0);
  return finite(strength * STRATEGY_PARAMETERS.goldPerFieldStrength
    * occupiedTicks / STRATEGY_PARAMETERS.utilityHorizonTicks, 'force time cost', 0);
}

type UtilityInput = Pick<Utility, 'benefit' | 'cost' | 'successProbability'>
  & { evidence: Utility['evidence'] | (() => Utility['evidence']) }
  & Partial<Pick<Utility, 'horizonTicks' | 'persistenceBonus'>>;

/** Failed attempts still incur their expected costs. A success-only expense is
 * a negative benefit term. Paid, unrecoverable sunk expenses are not paid twice. */
export function strategyUtility(input: UtilityInput): Utility {
  const probability = finite(input.successProbability, 'success probability', 0);
  if (probability > 1) throw new Error(`Invalid strategy success probability: ${probability}`);
  const benefit = input.benefit.map(term => deferredRecord(projectedCopy(term, { value: finite(term.value, `benefit ${term.code}`) })));
  const cost = input.cost.map(term => deferredRecord(projectedCopy(term, { value: finite(term.value, `cost ${term.code}`, 0) })));
  const persistenceBonus = finite(input.persistenceBonus ?? 0, 'persistence bonus', 0);
  const horizonTicks = finite(input.horizonTicks ?? STRATEGY_PARAMETERS.utilityHorizonTicks, 'utility horizon', 1);
  const score = finite(probability * benefit.reduce((sum, term) => sum + term.value, 0)
    - cost.reduce((sum, term) => sum + term.value, 0) + persistenceBonus, 'utility score');
  const source = typeof input.evidence === 'function' ? input.evidence : valueReader(input.evidence);
  return deferredEvidence({ horizonTicks, benefit, cost, successProbability: probability, persistenceBonus, score }, copiedEvidenceProjection(source));
}
