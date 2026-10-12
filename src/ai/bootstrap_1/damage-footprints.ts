import { itemEquipped, itemsFor } from '../../shared/equipment';
import { LIGHTNING_ROD, STORM_STAFF, NEUTRAL_ITEM_TARGET_RANGE, NEUTRAL_STORM_TARGET_RANGE } from '../../shared/item-rules';
import { resolveUnitDamage } from '../../shared/damage';
import { ITEM_DAMAGE_PROFILES } from '../../shared/damage-types';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { isEnemyOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';

/** Ready carried impacts reachable within one decision's relative movement budget. */
export function incomingItemDamage(snapshot: GameSnapshot, patient: Unit, foes: readonly (Unit | Building)[], horizon: number) {
  return foes.reduce((damage, foe) => damage + ('order' in foe ? itemsFor(snapshot, foe).reduce((total, item) => {
    if (!itemEquipped(snapshot, foe, item) || item.cooldownRemaining > horizon
      || item.kind !== 'lightningRod' && item.kind !== 'stormStaff') return total;
    const range = foe.owner === 'neutral' ? item.kind === 'lightningRod' ? NEUTRAL_ITEM_TARGET_RANGE : NEUTRAL_STORM_TARGET_RANGE
      : item.kind === 'lightningRod' ? LIGHTNING_ROD.range : STORM_STAFF.range;
    const closing = (foe.speed + patient.speed) * horizon / SIM_TICKS_PER_SECOND;
    if (distance(foe, patient) > range + closing) return total;
    return total + resolveUnitDamage(snapshot, patient,
      item.kind === 'lightningRod' ? LIGHTNING_ROD.damage : STORM_STAFF.impactDamage, ITEM_DAMAGE_PROFILES[item.kind]).damage;
  }, 0) : 0), 0);
}

/** Damage areas have their own centers; an ally can carry a ground-targeted spell beyond its caster's reach. */
export function hostileDamageDisks(snapshot: GameSnapshot, patient: Unit, foes: readonly (Unit | Building)[], horizon: number) {
  const teams = {};
  const active = snapshot.effects.filter(effect => (effect.type === 'storm' || effect.type === 'burningGround')
    && isEnemyOwner(snapshot, patient.owner, effect.owner!, teams)).map(effect =>
    ({ x: effect.x, y: effect.y, radius: effect.radius! + (effect.type === 'burningGround' ? patient.radius : 0) }));
  const allies = snapshot.units.filter(unit => unit.id !== patient.id && !unit.deck
    && !isEnemyOwner(snapshot, patient.owner, unit.owner, teams));
  const impacts = foes.flatMap(foe => 'order' in foe && itemsFor(snapshot, foe).some(item => item.kind === 'stormStaff'
    && item.cooldownRemaining <= horizon) ? allies.filter(ally => distance(foe, ally)
      <= (foe.owner === 'neutral' ? NEUTRAL_STORM_TARGET_RANGE : STORM_STAFF.range)
        + foe.speed * horizon / SIM_TICKS_PER_SECOND).map(ally =>
      ({ x: ally.x, y: ally.y, radius: STORM_STAFF.radius + ally.speed * horizon / SIM_TICKS_PER_SECOND })) : []);
  return [...active, ...impacts];
}
