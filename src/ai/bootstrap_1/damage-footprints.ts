import { itemsFor } from '../../shared/equipment';
import { STORM_STAFF, NEUTRAL_STORM_TARGET_RANGE } from '../../shared/item-rules';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { isEnemyOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';

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
