import { unitRules } from '../../shared/catalog';
import type { GameSnapshot } from '../../shared/types';
import type { GoalHullCandidate, GoalSeaLeg } from './goal-grounding-ports';
import type { GoalCombatOption, GoalEntityReference, GoalEstimate } from './goal-planner-types';
import { voyageExpectedLoss } from './voyage-risk';

/** One atom, one published sea leg. Pickup repositioning is priced by its
 * separate atom, while actual occupants remain exposed on either leg. */
export function valueGoalSeaLeg(input: Readonly<{
  snapshot: GameSnapshot; owner: string; hull: GoalHullCandidate;
  leg: GoalEstimate<GoalSeaLeg>; passengers?: readonly GoalEntityReference[];
}>): Pick<GoalCombatOption, 'cost' | 'successProbability'> {
  const ids = [...new Set([...input.hull.factIds, ...(input.leg.state === 'met' ? input.leg.factIds : input.leg.reason.factIds)])].sort();
  const pending = (code: string, requests: readonly string[] = ids): Pick<GoalCombatOption, 'cost' | 'successProbability'> => {
    const estimate = { state: 'pending' as const, requestIds: requests.length ? requests : [input.hull.id],
      reason: { code, factIds: ids, values: {} } };
    return { cost: estimate, successProbability: estimate };
  };
  if (input.leg.state !== 'met') return { cost: input.leg, successProbability: input.leg };
  const ship = input.hull.reference.kind === 'existing' ? input.snapshot.units.find(unit => input.hull.reference.kind === 'existing'
    && unit.id === input.hull.reference.entityId && unit.owner === input.owner && unit.hp > 0) : undefined;
  if (!ship || ship.kind !== input.hull.assessment.kind) return pending('goal-voyage-actual-hull-required');
  const risk = input.leg.value.risk;
  if (!risk || risk.status !== 'known') return pending(risk?.reasonCode ?? 'goal-voyage-leg-risk-unpublished');
  if (!Number.isFinite(risk.survivalProbability) || risk.survivalProbability < 0 || risk.survivalProbability > 1)
    return pending('goal-voyage-leg-risk-invalid');
  const refs = input.passengers ?? [];
  if (refs.some(reference => reference.kind !== 'existing')) return pending('goal-voyage-actual-passenger-pool-required');
  const passengers = refs.flatMap(reference => reference.kind === 'existing' ? [reference.entityId] : []);
  const cargo = input.snapshot.units.filter(unit => unit.hp > 0 && (unit.deck?.shipId ?? unit.cabin?.shipId) === ship.id);
  if (cargo.some(unit => unit.owner !== input.owner) || passengers.some(id => !input.snapshot.units.some(unit => unit.id === id
    && unit.owner === input.owner && unit.hp > 0))) return pending('goal-voyage-passenger-control-unproved');
  const residual = unitRules(input.snapshot, ship).cost * Math.min(1, ship.hp / Math.max(1, ship.maxHp));
  const value = voyageExpectedLoss({ snapshot: input.snapshot, shipId: ship.id, passengerIds: passengers,
    shipResidualGold: residual, survivalProbability: risk.survivalProbability });
  if (value.status !== 'known') return pending(value.reasonCode, value.unknownIds);
  const facts = [...new Set([...ids, ship.id, ...value.passengers.map(passenger => passenger.unitId), ...risk.threatIds])].sort();
  return { cost: { state: 'met', value: [
    { code: 'native-voyage-hull-loss', gold: value.hullLossGold, factIds: facts },
    { code: 'native-voyage-passenger-loss', gold: value.passengerLossGold, factIds: facts },
  ], factIds: facts }, successProbability: { state: 'met', value: risk.survivalProbability, factIds: facts } };
}
