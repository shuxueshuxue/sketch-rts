import { ABILITY_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { groundSteeringRoute } from '../../shared/route-selection';
import { sameGround, walkDestination, walkableGoal, walkingDistance } from '../../shared/terrain';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { weaponRules } from '../../shared/equipment';
import { strikeGap } from '../../shared/combat-geometry';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { planRangedKiting } from '../policy/skirmish-tactics';
import { planFocusFireCommand } from '../policy/spell-tactics';
import { enemyCombatUnits, hostileCombatUnits } from '../policy/snapshot';
import { averagePoint, distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { casterScreenNeighbors, isBacklineKind, planCasterScreen } from '../policy/v6/backline';
import { SUMMONING_UNIT_KINDS } from '../policy/versions';
import { isOpponentOwner } from '../policy/ownership';
import { armedFoes } from './safe-land-route';
import { casterMeleeMicro, releaseMedicalBackline } from './caster-screen';
import { mountedMicro, mountedTargetOrder, mountedThreatReach, THINK_TICKS } from './mounted-micro';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { capsuleClearsBodies } from '../../shared/navigation-math';
import { constrainGroundShipStep } from '../../shared/ship-collisions';
import { casterScreenOutsideFixedFire } from './caster-fixed-fire';
import { landedShipFireEscape } from './landed-ship-fire';

function healer(unit: Unit) {
  return UNIT_DEFS[unit.kind].abilities.some(ability => ABILITY_DEFS[ability].behavior === 'heal');
}

/** Naval ownership includes the fighting after landing. Its local queries use
 * the real snapshot, preserving terrain, bodies, care and transport ownership. */
export function planLandedCombat(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  unavailable: ReadonlySet<string>, medicalReleases: ReadonlySet<string> = new Set()): GameCommand[] {
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall');
  if (!home) return [];
  const landed = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land'
    && unit.kind !== 'worker' && !sameGround(snapshot.map, unit, home) && unit.order.type !== 'board');
  const foes = hostileCombatUnits(snapshot, owner, options.teams);
  const near = casterScreenNeighbors(landed);
  const handled = new Set<string>(), commands: GameCommand[] = [];
  for (const anchor of landed) {
    if (handled.has(anchor.id)) continue;
    const group = near(anchor).filter(unit => !handled.has(unit.id) && sameGround(snapshot.map, anchor, unit));
    for (const unit of group) handled.add(unit.id);
    const enemies = foes.filter(foe => sameGround(snapshot.map, anchor, foe)
      && group.some(unit => distance(unit, foe) <= 900));
    if (!enemies.length) {
      const ships = snapshot.units.filter(unit => unit.hp > 0 && unit.sailing
        && isOpponentOwner(snapshot, owner, unit.owner, options));
      for (const unit of group.filter(unit => !unavailable.has(unit.id) && !medicalReleases.has(unit.id))) {
        const escape = landedShipFireEscape(snapshot, unit, ships);
        if (escape) commands.push(escape);
      }
      if (!group.some(unit => medicalReleases.has(unit.id))) continue;
    }
    const army = group.filter(unit => !unavailable.has(unit.id) && !unit.orderQueue?.length
      && (enemies.length > 0 || medicalReleases.has(unit.id))
      && (!['cast', 'charge', 'repair', 'repairUnit', 'repairShip', 'pickupItem'].includes(unit.order.type)
        || medicalReleases.has(unit.id) && unit.order.type === 'cast' && ABILITY_DEFS[unit.order.ability].behavior === 'heal'));
    if (!army.length) continue;
    // An existing soldier behind this front is a local anchor. The centroid
    // alone can be water; the mainland town hall is across an actual sea road.
    const danger = enemies.length ? enemies : armedFoes(snapshot, owner, options).filter(foe => sameGround(snapshot.map, anchor, foe));
    const threat = danger.length ? averagePoint(danger) : anchor;
    const cover = group.filter(candidate => {
      const neighbors = new Set(near(candidate));
      return army.every(unit => neighbors.has(unit));
    })
      .sort((a, b) => distance(b, threat) - distance(a, threat))[0]!;
    const occupied = new Set<string>();
    const accept = (candidates: GameCommand[], screen = false) => {
      for (const command of candidates) {
        if (!('unitIds' in command)) continue;
        const unitIds = command.unitIds.filter(id => army.some(unit => unit.id === id) && !occupied.has(id)
          && (command.type !== 'attack' || !healer(army.find(unit => unit.id === id)!)));
        if (!unitIds.length) continue;
        if (command.type === 'move' || command.type === 'attackMove') {
          // Resolve each soldier's native land endpoint and road separately.
          // Never turn a rejected local step into a cross-island retreat.
          for (const id of unitIds) {
            const unit = army.find(unit => unit.id === id)!;
            const goal = walkDestination(snapshot.map, unit, walkableGoal(snapshot.map, command.x, command.y));
            if (!sameGround(snapshot.map, unit, goal) || walkingDistance(snapshot.map, unit, goal, 'land') === undefined) continue;
            const road = groundSteeringRoute(snapshot.map, unit, goal);
            if (distance(road[road.length - 1]!, goal) > MOVE_ORDER_ARRIVAL_RANGE) continue;
            const selected = { ...command, unitIds: [id], ...goal };
            commands.push(...(screen ? casterScreenOutsideFixedFire(snapshot, owner, options, [selected], medicalReleases) : [selected]));
            occupied.add(id);
          }
        } else {
          commands.push({ ...command, unitIds });
          for (const id of unitIds) occupied.add(id);
        }
      }
    };
    const front = group.filter(unit => !isBacklineKind(unit) && !unavailable.has(unit.id));
    const casters = army.filter(isBacklineKind);
    const fightingMicro = casterMeleeMicro(snapshot, owner, options);
    const micro = (caster: Unit, threats: Unit[]) => healer(caster) ? undefined : fightingMicro(caster, threats);
    // The shared mainland query intentionally hides uncolonized islands.
    // This expedition already owns the actual fight on this island.
    const towers = snapshot.buildings.filter(building => isOpponentOwner(snapshot, owner, building.owner, options)
      && sameGround(snapshot.map, anchor, building));
    const screen: GameCommand[] = [];
    for (const close of [false, true]) screen.push(...planCasterScreen(snapshot, owner, options, cover, cover, front,
      casters.filter(unit => SUMMONING_UNIT_KINDS.has(unit.kind) !== close), close, true, micro, caster => !healer(caster), towers));
    accept(releaseMedicalBackline(snapshot, owner, options, cover, casters.filter(unit => medicalReleases.has(unit.id)), screen), true);
    // Preserve each executable ordinary stutter/shot. Repair only a missing
    // action inside native melee coverage or a kite cut off by live bodies.
    const ordinary = planRangedKiting(snapshot, owner, options, army.filter(unit => !occupied.has(unit.id) && !healer(unit)), enemies, cover);
    const kites = new Map(ordinary.flatMap(command => 'unitIds' in command ? command.unitIds.map(id => [id, command] as const) : []));
    const threats = armedFoes(snapshot, owner, options).filter(foe => sameGround(snapshot.map, anchor, foe));
    for (const shooter of army.filter(unit => !occupied.has(unit.id) && !healer(unit)
      && unit.attackRange > 100 && unit.attackDamage > 0)) {
      const kite = kites.get(shooter.id);
      const bodies = snapshot.units.filter(unit => unit.id !== shooter.id && !unit.deck
        && unitMover(unit.kind) === 'land' && !(unit.kind === 'worker' && unit.order.type === 'mine'));
      const road = kite?.type === 'move' ? groundSteeringRoute(snapshot.map, shooter, kite) : [];
      const blocked = road.slice(1).some((point, index) => !capsuleClearsBodies(road[index]!, point, shooter.radius, bodies)
        || constrainGroundShipStep(snapshot.map, shooter, road[index]!, point, snapshot.units) !== point);
      if (kite && !blocked) continue;
      const horizon = THINK_TICKS + shooter.cooldown;
      const localThreats = threats.filter(foe => distance(shooter, foe) <= Math.max(shooter.attackRange,
        mountedThreatReach(snapshot, foe, shooter, horizon))
        + (shooter.speed + ('speed' in foe ? foe.speed : 0)) * THINK_TICKS / SIM_TICKS_PER_SECOND);
      if (!blocked && !localThreats.some(foe => 'order' in foe && foe.attackRange <= 80
        && distance(shooter, foe) <= mountedThreatReach(snapshot, foe, shooter, horizon))) continue;
      const target = [...enemies].sort(mountedTargetOrder)[0];
      if (target) accept([mountedMicro(snapshot, shooter, target, localThreats, { kind: 'field' })]);
    }
    accept(ordinary);
    const focus = planFocusFireCommand(snapshot, owner, options, {
      army: army.filter(unit => !occupied.has(unit.id) && !healer(unit) && unit.attackDamage > 0),
      enemies: enemyCombatUnits(snapshot, owner, options.teams).filter(enemy => enemies.includes(enemy)),
      canJoinTarget: (fighter, target) => sameGround(snapshot.map, fighter, target)
        && walkingDistance(snapshot.map, fighter, target, 'land') !== undefined
        && strikeGap(fighter, target) >= (weaponRules(snapshot, fighter).weapon?.minRange ?? 0),
    });
    if (focus) accept([focus]);
  }
  return commands;
}
