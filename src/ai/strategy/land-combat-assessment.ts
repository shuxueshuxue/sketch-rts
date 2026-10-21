import { UNIT_DEFS } from '../../shared/catalog';
import type { Building, Unit } from '../../shared/types';
import { forceSuccessProbability } from './utility';

export type LandCombatBody = Pick<Unit | Building, 'id' | 'hp' | 'attackDamage' | 'attackCooldown'>;
export type LandCombatFiringSource = Readonly<{
  body: LandCombatBody;
  /** Published relative ETA. Null denotes an on-site or static source. */
  arrivalTicks: number | null;
  expiresTick: number | null;
}>;

/** The existing land model's target-HP / exact raw-weapon DPS estimate. This
 * does not select a cohort or look up targets, paths, equipment or responders. */
export function landCombatWorkTicks(targets: readonly Pick<LandCombatBody, 'hp'>[],
  fighters: readonly Pick<Unit, 'attackDamage' | 'attackCooldown'>[], holdingTicks?: number): number {
  return holdingTicks ?? Math.max(1, targets.reduce((sum, target) => sum + target.hp, 0)
    / Math.max(1e-6, fighters.reduce((sum, fighter) => sum + fighter.attackDamage / Math.max(1, fighter.attackCooldown), 0)));
}

/** Lifetime coverage in the old land responder model, after reachability and
 * arrival-within-window have been established by the shared fact reader. */
export function landCombatResponseCoverage(now: number, windowTicks: number, arrivalTicks: number,
  expiresTick: number | null): number {
  return expiresTick === null ? 1 : Math.min(1, (expiresTick - now - arrivalTicks) / Math.max(1, windowTicks - arrivalTicks));
}

/** Shared pure arithmetic from LandModel. Field-strength remains the success
 * model's currency; neither input is an additive combat-rating threshold.
 * Source IDs are deduplicated in original encounter order, as in LandModel. */
export function assessLandCombatAttrition(input: Readonly<{
  tick: number; arrivalTicks: number; workTicks: number;
  fighters: readonly Pick<Unit, 'kind' | 'hp'>[];
  firing: readonly LandCombatFiringSource[];
  fieldStrength: number; requiredFieldStrength: number;
}>): Readonly<{ damage: number; expectedLossGold: number; successProbability: number }> {
  const exposedHp = input.fighters.reduce((sum, fighter) => sum + fighter.hp, 0);
  const price = input.fighters.reduce((sum, fighter) => sum + UNIT_DEFS[fighter.kind].cost, 0);
  const firing = new Map(input.firing.map(source => [source.body.id, source]));
  const damage = [...firing.values()].reduce((sum, source) => {
    const starts = source.arrivalTicks === null ? input.arrivalTicks : Math.max(input.arrivalTicks, source.arrivalTicks);
    const ends = source.expiresTick === null ? input.arrivalTicks + input.workTicks
      : Math.min(input.arrivalTicks + input.workTicks, source.expiresTick - input.tick);
    return sum + source.body.attackDamage / Math.max(1, source.body.attackCooldown) * Math.max(0, ends - starts);
  }, 0);
  const successProbability = forceSuccessProbability(input.fieldStrength, input.requiredFieldStrength);
  return { damage, expectedLossGold: Math.min(price, price * damage / Math.max(1, exposedHp)) * (1 - successProbability),
    successProbability };
}
