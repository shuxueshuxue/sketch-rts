import { sameGround, walkableGoal, walkDestination } from '../../shared/terrain';
import { nearestByRoute, routeTravelTicks } from '../../shared/route-selection';
import { ABILITY_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { canReceiveHealing } from '../../shared/healing';
import { matchesUnitTarget } from '../../shared/unit-targeting';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { armedFoes } from './safe-land-route';
import { distance } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';
import { mountedEscape, mountedThreatReach, THINK_TICKS } from './mounted-micro';
import { hostileDamageDisks } from './damage-footprints';

function campRecoveryPatients(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const camps = [options.memory.v6?.creep, options.memory.landExpansion?.combat?.creep]
    .filter((camp): camp is NonNullable<typeof camp> => camp !== undefined);
  if (!camps.length) return [];
  const foes = armedFoes(snapshot, owner, options);
  const healers = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unit.hp > 0
    && UNIT_DEFS[unit.kind].abilities.some(ability => ABILITY_DEFS[ability].behavior === 'heal')
    && foes.every(foe => distance(unit, foe) > mountedThreatReach(snapshot, foe, unit, 0)));
  return snapshot.units.filter(unit => unit.owner === owner && camps.some(camp => camp.group.includes(unit.id))
    && unit.expiresTick === undefined && unit.hp < unit.maxHp).map(patient => {
      const camp = camps.find(camp => camp.group.includes(patient.id))!;
      const care = canReceiveHealing(patient, snapshot) ? healers.filter(healer => UNIT_DEFS[healer.kind].abilities.some(ability =>
        ABILITY_DEFS[ability].behavior === 'heal' && matchesUnitTarget(patient, ABILITY_DEFS[ability].targets, snapshot))) : [];
      const healer = nearestByRoute(snapshot.map, care, patient, 'land');
      const destination = healer === undefined ? camp.staging : healer;
      return { patient, point: walkDestination(snapshot.map, patient,
        walkableGoal(snapshot.map, destination.x, destination.y)) };
    }).filter(({ patient, point }) => {
    const travel = routeTravelTicks(snapshot.map, patient, point, 'land', patient.speed);
    // Recovery belongs to this camp only while its care destination remains reachable.
    if (travel === undefined) return false;
    const window = THINK_TICKS + travel;
    const flying = snapshot.projectiles.filter(shot => shot.targetId === patient.id && shot.remaining <= window)
      .reduce((damage, shot) => damage + shot.damage, 0);
    const attacks = foes.reduce((damage, foe) => damage + ('order' in foe
      && (foe.order.type === 'attack' || foe.order.type === 'attackMove') && foe.order.targetId === patient.id
      ? foe.attackDamage * Math.max(0, Math.ceil((window - foe.cooldown) / foe.attackCooldown)) : 0), 0);
    return patient.hp < patient.maxHp * V7_WOUNDED_SHARE || patient.hp <= flying + attacks;
  });
}

/** Predict exposed camp casualties before battlefield target selection can claim them. */
export const campRecovery: AiScript = {
  id: 'campRecovery', phase: 'tactics', redirects: 'local',
  claimsUnits: (snapshot, owner, options) => new Set(campRecoveryPatients(snapshot, owner, options).map(({ patient }) => patient.id)),
  run: (snapshot, owner, options): GameCommand[] => {
    const patients = campRecoveryPatients(snapshot, owner, options);
    if (!patients.length) return [];
    const foes = armedFoes(snapshot, owner, options);
    return patients.map(({ patient, point }) => {
      const threats = foes.filter(foe => sameGround(snapshot.map, patient, foe)
        && distance(patient, foe) <= mountedThreatReach(snapshot, foe, patient, THINK_TICKS)
          + ('speed' in foe ? foe.speed : 0) * (THINK_TICKS + 2) / SIM_TICKS_PER_SECOND);
      const indirect = hostileDamageDisks(snapshot, patient, foes, THINK_TICKS)
        .some(area => distance(patient, area) <= area.radius);
      if (threats.length || indirect) {
        return mountedEscape(snapshot, patient, indirect ? foes : threats, 0, point, true);
      }
      return distance(patient, point) <= V7_GATHERED_RANGE
        ? { type: 'holdPosition', unitIds: [patient.id] }
        : { type: 'move', unitIds: [patient.id], ...point, avoidCombat: true };
    });
  },
};
