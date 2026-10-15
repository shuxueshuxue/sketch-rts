import { ABILITY_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { canReceiveHealing } from '../../shared/healing';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { groundSteeringRoute, nearestByRoute, routePrefix, routeTravelTicks } from '../../shared/route-selection';
import { sameGround } from '../../shared/terrain';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { capsuleClearsBodies } from '../../shared/navigation-math';
import { navalUnitIds } from '../policy/naval';
import { isEnemyOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { isBacklineKind } from '../policy/v6/backline';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';
import { postRecoveryAssignments } from './front-recovery';
import { clearOfBuildingArrival, mountedEscape, mountedThreatReach, THINK_TICKS } from './mounted-micro';

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

export function landRecoveryAssignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, landed: Unit[]) {
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

export function patientRendezvousCommands(snapshot: GameSnapshot,
  recovering: ReturnType<typeof landRecoveryAssignments>['recovering'], foes: readonly (Unit | Building)[], medics: ReadonlySet<string>): GameCommand[] {
  return recovering.filter(({ patient }) => !medics.has(patient.id)).map(({ patient, healer }) => {
    const threats = patientThreats(snapshot, patient, foes);
    if (threats.length) {
      const ability = UNIT_DEFS[healer.kind].abilities.find(ability => ABILITY_DEFS[ability].behavior === 'heal')!;
      if (distance(patient, healer) <= ABILITY_DEFS[ability].range) return mountedEscape(snapshot, patient, threats, 0, healer, true);
      // Transit follows the actual care road; a short endpoint leaves the front's objective intact after healing.
      const road = groundSteeringRoute(snapshot.map, patient, healer);
      const prefix = routePrefix(patient, road.slice(1), patient.speed * THINK_TICKS / SIM_TICKS_PER_SECOND + MOVE_ORDER_ARRIVAL_RANGE);
      const point = prefix[prefix.length - 1]!;
      const blockers = foes.filter((foe): foe is Unit => 'order' in foe && !foe.deck && unitMover(foe.kind) === 'land')
        .map(foe => ({ x: foe.x, y: foe.y, radius: foe.radius + (foe.attackRange <= 100 ? foe.attackRange : 0) }));
      if (!capsuleClearsBodies(patient, point, patient.radius, blockers) || !clearOfBuildingArrival(snapshot, patient, point))
        return mountedEscape(snapshot, patient, threats, 0, healer, true);
      return { type: 'move', unitIds: [patient.id], x: point.x, y: point.y, avoidCombat: true };
    }
    return { type: 'follow', unitIds: [patient.id], targetId: healer.id };
  });
}

export function mainlandCareAssignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  if (!home) return undefined;
  const own = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land'
    && unit.kind !== 'worker' && unit.order.type !== 'board' && sameGround(snapshot.map, unit, home));
  if (!own.some(unit => unit.expiresTick === undefined && unit.hp < unit.maxHp)) return undefined;
  const reserved = navalUnitIds(snapshot, owner, options, () => false);
  const care = landRecoveryAssignments(snapshot, owner, options, own.filter(unit => !reserved.has(unit.id)));
  const medics = new Set(care.recovering.map(({ healer }) => healer.id));
  const recovering = care.recovering.filter(({ patient }) => !medics.has(patient.id)
    && !options.memory.v6?.creep?.group.includes(patient.id))
    .map(pair => ({ ...pair, foes: care.foes, medics }));
  const occupied = new Set([...reserved, ...care.posts.map(({ patient }) => patient.id), ...care.recovering.map(({ patient }) => patient.id),
    ...options.memory.v6?.creep?.group ?? [], ...options.memory.mounted?.flatMap(job => job.unitIds) ?? [],
    ...options.memory.v6?.raid?.unitIds ?? [], ...options.memory.v6?.closeout?.unitIds ?? [], ...options.memory.support?.unitIds ?? [],
    ...[options.memory.loot?.unitId, options.memory.shopping?.unitId, options.memory.mercenaryCourier?.unitId].filter((id): id is string => !!id),
    ...Object.entries(options.memory.unitClaims).filter(([, claim]) => claim.expiresTick > snapshot.tick).map(([id]) => id)]);
  // A mainland attack needs the same unmedicated escape as a landed force.
  // Remain safe while critically wounded even after leaving current coverage;
  // an absent medic is not permission to turn around and resume the assault.
  const unmedicated = own.filter(unit => unit.expiresTick === undefined && !occupied.has(unit.id) && !isBacklineKind(unit)
    && unit.hp < unit.maxHp * V7_WOUNDED_SHARE && !unit.orderQueue?.length
    && !['cast', 'charge', 'repairShip', 'repair', 'repairUnit', 'pickupItem'].includes(unit.order.type)).map(patient => {
      const planned = care.unmedicated.find(pair => pair.patient.id === patient.id);
      return planned ?? { patient, cover: patient.order.type === 'move' && patient.order.avoidCombat
        ? { x: patient.order.x, y: patient.order.y } : { x: patient.x, y: patient.y } };
    });
  return { recovering, unmedicated, foes: care.foes };
}
