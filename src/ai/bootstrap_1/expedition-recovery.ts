import { ABILITY_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { canReceiveHealing } from '../../shared/healing';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { nearestByRoute } from '../../shared/route-selection';
import { sameGround } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { planNavalTactics } from '../policy/naval';
import { isEnemyOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';
import { planMedicalRecovery } from './medical-recovery';
import { mountedEscape, mountedThreatReach, THINK_TICKS } from './mounted-micro';

/** An expedition's naval ownership also owns its land recovery orders. */
export function planBootstrapNaval(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const commands = planNavalTactics(snapshot, owner, options);
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  const landed = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land'
    && unit.kind !== 'worker' && unit.order.type !== 'board' && home && !sameGround(snapshot.map, unit, home));
  const healers = landed.filter(unit => UNIT_DEFS[unit.kind].abilities.some(ability => ABILITY_DEFS[ability].behavior === 'heal'));
  const foes = healers.length ? [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options)) : [];
  const recovering = landed.filter(unit => unit.expiresTick === undefined && unit.hp < unit.maxHp
    && canReceiveHealing(unit, snapshot)).flatMap(patient => {
    const healer = nearestByRoute(snapshot.map, healers, patient, 'land');
    if (!healer) return [];
    const ability = UNIT_DEFS[healer.kind].abilities.find(ability => ABILITY_DEFS[ability].behavior === 'heal')!;
    const window = Math.max(THINK_TICKS, abilityCooldown(healer, ability));
    const incoming = foes.reduce((damage, foe) => damage + ('order' in foe
      && (foe.order.type === 'attack' || foe.order.type === 'attackMove') && foe.order.targetId === patient.id
      ? foe.attackDamage * Math.max(0, Math.ceil((window - foe.cooldown) / foe.attackCooldown)) : 0), 0);
    return patient.hp < patient.maxHp * V7_WOUNDED_SHARE || patient.hp <= incoming ? [{ patient, healer }] : [];
  });
  const medics = new Set(recovering.map(({ healer }) => healer.id));
  const healing = medics.size ? planMedicalRecovery(snapshot, owner, recovering.map(({ patient }) => patient)).filter(command =>
    'unitId' in command ? medics.has(command.unitId) : 'unitIds' in command && command.unitIds.some(id => medics.has(id))) : [];
  const retreat: GameCommand[] = recovering.filter(({ patient }) => !medics.has(patient.id)).map(({ patient, healer }) => {
    const threats = foes.filter(foe => sameGround(snapshot.map, patient, foe)
      && distance(patient, foe) <= mountedThreatReach(snapshot, foe, patient, THINK_TICKS)
        + ('speed' in foe ? foe.speed : 0) * (THINK_TICKS + 2) / SIM_TICKS_PER_SECOND);
    if (threats.length) {
      const command = mountedEscape(snapshot, patient, threats, 0, healer);
      return command.type === 'move' ? { ...command, avoidCombat: true } : command;
    }
    return { type: 'follow', unitIds: [patient.id], targetId: healer.id };
  });
  const reserved = new Set([...recovering.map(({ patient }) => patient.id), ...medics]);
  return [...commands.flatMap((command): GameCommand[] => {
    if ('unitId' in command) return reserved.has(command.unitId) ? [] : [command];
    if (!('unitIds' in command)) return [command];
    const unitIds = command.unitIds.filter(id => !reserved.has(id));
    return unitIds.length ? [{ ...command, unitIds }] : [];
  }), ...retreat, ...healing];
}
