import { ABILITY_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { canReceiveHealing } from '../../shared/healing';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { nearestByRoute, routeTravelTicks } from '../../shared/route-selection';
import { sameGround } from '../../shared/terrain';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { planNavalTacticsWithAssignments } from '../policy/naval';
import { shipNeedsRepair } from '../../shared/ship-equipment';
import { isEnemyOwner } from '../policy/ownership';
import { mountedMinePlan } from '../policy/mounted-mine-plan';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';
import { planMedicalRecovery } from './medical-recovery';
import { mountedEscape, mountedThreatReach, THINK_TICKS } from './mounted-micro';
import { planSettlerBoarding } from './ferry-preparation';
import { planRiderCrossing, riderFerryCrew } from './rider-crossing';
import { transportRecovery } from './transport-recovery';
import { postRecoveryAssignments, postRecoveryCommands } from './front-recovery';

function patientThreats(snapshot: GameSnapshot, patient: Unit, foes: readonly (Unit | Building)[]) {
  return foes.filter(foe => sameGround(snapshot.map, patient, foe)
    && distance(patient, foe) <= mountedThreatReach(snapshot, foe, patient, THINK_TICKS)
      + ('speed' in foe ? foe.speed : 0) * (THINK_TICKS + 2) / SIM_TICKS_PER_SECOND);
}

function incomingDamage(patient: Unit, foes: readonly (Unit | Building)[], window: number) {
  return foes.reduce((damage, foe) => damage + ('order' in foe
    && (foe.order.type === 'attack' || foe.order.type === 'attackMove') && foe.order.targetId === patient.id
    ? foe.attackDamage * Math.max(0, Math.ceil((window - foe.cooldown) / foe.attackCooldown)) : 0), 0);
}

function recoveryAssignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  const landed = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land'
    && unit.kind !== 'worker' && unit.order.type !== 'board' && home && !sameGround(snapshot.map, unit, home));
  const healers = landed.filter(unit => UNIT_DEFS[unit.kind].abilities.some(ability => ABILITY_DEFS[ability].behavior === 'heal'));
  const posts = postRecoveryAssignments(snapshot, owner, options).filter(({ patient }) => landed.includes(patient));
  const resting = new Set(posts.map(({ patient }) => patient.id));
  const foes = landed.length ? [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options)) : [];
  const unmedicated = landed.filter(unit => !resting.has(unit.id) && unit.expiresTick === undefined && unit.hp < unit.maxHp
    && (!canReceiveHealing(unit, snapshot) || nearestByRoute(snapshot.map, healers, unit, 'land') === undefined)).flatMap(patient => {
    const threats = patientThreats(snapshot, patient, foes);
    if (!threats.length) return [];
    const danger = [...threats].sort((a, b) => distance(patient, a) - mountedThreatReach(snapshot, a, patient, THINK_TICKS)
      - (distance(patient, b) - mountedThreatReach(snapshot, b, patient, THINK_TICKS)))[0]!;
    // Finish the retreat instead of chasing a new point behind a moving protector.
    const covers = patient.order.type === 'move' && patient.order.avoidCombat ? [{ x: patient.order.x, y: patient.order.y }]
      : landed.filter(unit => unit.id !== patient.id && unit.hp / unit.maxHp > patient.hp / patient.maxHp).map(unit => {
      const angle = Math.atan2(unit.y - danger.y, unit.x - danger.x), reach = mountedThreatReach(snapshot, danger, patient, THINK_TICKS);
      return { x: unit.x + Math.cos(angle) * reach, y: unit.y + Math.sin(angle) * reach };
    });
    const cover = nearestByRoute(snapshot.map, covers, patient, 'land');
    if (!cover) return [];
    const window = THINK_TICKS + routeTravelTicks(snapshot.map, patient, cover, 'land', patient.speed)!;
    return patient.hp < patient.maxHp * V7_WOUNDED_SHARE || patient.hp <= incomingDamage(patient, threats, window)
      || patient.order.type === 'move' && patient.order.avoidCombat ? [{ patient, threats, cover }] : [];
  });
  const recovering = landed.filter(unit => !resting.has(unit.id) && unit.expiresTick === undefined && unit.hp < unit.maxHp
    && canReceiveHealing(unit, snapshot)).flatMap(patient => {
    const healer = nearestByRoute(snapshot.map, healers, patient, 'land');
    if (!healer) return [];
    const ability = UNIT_DEFS[healer.kind].abilities.find(ability => ABILITY_DEFS[ability].behavior === 'heal')!;
    const window = Math.max(THINK_TICKS, abilityCooldown(healer, ability));
    return patient.hp < patient.maxHp * V7_WOUNDED_SHARE || patient.hp <= incomingDamage(patient, foes, window) ? [{ patient, healer }] : [];
  });
  return { recovering, unmedicated, foes, posts };
}

export function expeditionRecoveryUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const { recovering, unmedicated, posts } = recoveryAssignments(snapshot, owner, options);
  return new Set([...recovering.flatMap(({ patient, healer }) => [patient.id, healer.id]), ...unmedicated.map(({ patient }) => patient.id),
    ...posts.map(({ patient }) => patient.id), ...transportRecovery(snapshot, owner, options).ids]);
}

/** An expedition's naval ownership also owns its land recovery orders. */
export function planBootstrapNaval(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  planRiderCrossing(snapshot, owner, options);
  const mines = mountedMinePlan(snapshot, options.memory);
  const ports = transportRecovery(snapshot, owner, options);
  const { recovering, unmedicated, foes, posts } = recoveryAssignments(snapshot, owner, options);
  const medics = new Set(recovering.map(({ healer }) => healer.id));
  const reserved = new Set([...recovering.map(({ patient }) => patient.id), ...unmedicated.map(({ patient }) => patient.id),
    ...posts.map(({ patient }) => patient.id), ...medics, ...ports.ids]);
  const mounted = new Set(options.memory.mounted?.flatMap(job => job.unitIds));
  const commands = planNavalTacticsWithAssignments(snapshot, owner, options, {
    orderCrew: (soldiers, shore, boat) => riderFerryCrew(snapshot, soldiers, shore, boat, options),
    mineEligible: mines.eligible, targetAvailable: mines.targetAvailable,
    transportReady: boat => !shipNeedsRepair(snapshot, boat),
    troopAvailable: unit => !mounted.has(unit.id) && !reserved.has(unit.id),
  });
  commands.push(...planSettlerBoarding(snapshot, owner, options, commands));
  const healing = medics.size ? planMedicalRecovery(snapshot, owner, recovering.map(({ patient }) => patient)).filter(command =>
    'unitId' in command ? medics.has(command.unitId) : 'unitIds' in command && command.unitIds.some(id => medics.has(id))) : [];
  const retreat: GameCommand[] = recovering.filter(({ patient }) => !medics.has(patient.id)).map(({ patient, healer }) => {
    const threats = patientThreats(snapshot, patient, foes);
    if (threats.length) {
      return mountedEscape(snapshot, patient, threats, 0, healer, true);
    }
    return { type: 'follow', unitIds: [patient.id], targetId: healer.id };
  });
  return [...commands.flatMap((command): GameCommand[] => {
    if ('unitId' in command) return reserved.has(command.unitId) ? [] : [command];
    if (!('unitIds' in command)) return [command];
    const unitIds = command.unitIds.filter(id => !reserved.has(id));
    return unitIds.length ? [{ ...command, unitIds }] : [];
  }), ...postRecoveryCommands(posts), ...retreat, ...unmedicated.map(({ patient, cover }): GameCommand =>
    ({ type: 'move', unitIds: [patient.id], ...cover, avoidCombat: true })), ...healing, ...ports.commands];
}
