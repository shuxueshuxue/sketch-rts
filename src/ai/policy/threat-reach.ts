import { isRangedUnit } from "../../shared/unit-weapon-class";
import { ABILITY_DEFS } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { sameGround } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { unitAbilities } from '../../shared/unit-abilities';
import { itemsFor } from '../../shared/equipment';
import { LIGHTNING_ROD, STORM_STAFF, NEUTRAL_ITEM_TARGET_RANGE, NEUTRAL_STORM_TARGET_RANGE } from '../../shared/item-rules';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { distance } from './spatial';

// How far a fighter, a skill or a carried item can strike from, over a horizon: what the AI's movement and recovery read as
// "in reach". A think is the horizon most of them use.
export const THINK_TICKS = 15;

type Threat = Unit | Building;

export function chargeMinimum(foe: Unit, rider: Pick<Unit, 'x' | 'y'>, horizon: number) {
  return unitAbilities(foe).flatMap(ability => {
    const rules = ABILITY_DEFS[ability];
    return rules.behavior === 'charge' && abilityCooldown(foe, ability) <= horizon
      && distance(rider, foe) < rules.minRange ? [rules.minRange] : [];
  });
}

export function mountedThreatReach(snapshot: GameSnapshot, foe: Threat, rider: Pick<Unit, 'x' | 'y' | 'radius'>, horizon: number) {
  if (!('order' in foe)) return foe.attackRange + rider.radius;
  const withinChargeMinimum = !isRangedUnit(foe) && unitAbilities(foe).some(ability => {
    const rules = ABILITY_DEFS[ability];
    return rules.behavior === 'charge' && abilityCooldown(foe, ability) <= horizon && distance(rider, foe) < rules.minRange;
  });
  const weaponReach = !isRangedUnit(foe) && !withinChargeMinimum ? foe.attackRange + foe.radius + rider.radius : foe.attackRange;
  return Math.max(weaponReach, castThreatReach(snapshot, foe, rider, horizon));
}

const ATTACK_BEHAVIORS = new Set(['charge', 'stomp', 'web', 'curse', 'weapon']);

/** Active skills and carried attacks can still execute while ordinary fire is suppressed by a move order. */
export function castThreatReach(snapshot: GameSnapshot, foe: Unit, rider: Pick<Unit, 'x' | 'y'>, horizon: number) {
  // This query is inside every unit/foe road check. Accumulate the same maximum
  // directly instead of allocating item, ability and flattened range arrays.
  let reach = 0;
  for (const item of itemsFor(snapshot, foe)) {
    if (item.cooldownRemaining <= horizon && (item.kind === 'stormStaff' || item.kind === 'lightningRod'))
      reach = Math.max(reach, foe.owner === 'neutral'
        ? item.kind === 'stormStaff' ? NEUTRAL_STORM_TARGET_RANGE : NEUTRAL_ITEM_TARGET_RANGE
        : item.kind === 'stormStaff' ? STORM_STAFF.range : LIGHTNING_ROD.range);
  }
  for (const ability of unitAbilities(foe)) {
    const rules = ABILITY_DEFS[ability];
    if (ATTACK_BEHAVIORS.has(rules.behavior)
      && abilityCooldown(foe, ability) <= horizon
      && !(rules.behavior === 'charge' && distance(rider, foe) < rules.minRange)) reach = Math.max(reach, rules.range);
  }
  return reach;
}


/** The foes that can strike this unit before the next think: it is in their fight. */
export function strikersOf(snapshot: GameSnapshot, unit: Unit, foes: readonly Threat[]) {
  return foes.filter(foe => sameGround(snapshot.map, unit, foe)
    && distance(unit, foe) <= mountedThreatReach(snapshot, foe, unit, THINK_TICKS)
      + ('speed' in foe ? foe.speed : 0) * (THINK_TICKS + 2) / SIM_TICKS_PER_SECOND);
}
