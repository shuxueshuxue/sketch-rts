import { ABILITY_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { aimingProfile } from '../../shared/aiming';
import { detCos, detSin } from '../../shared/det-math';
import { isWalkable, segmentWalkable, steerPoint } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { unitAbilities } from '../../shared/unit-abilities';
import type { Building, GameCommand, GameSnapshot, Unit } from '../../shared/types';
import { distance, type Point } from '../policy/spatial';

type Threat = Unit | Building;
const THINK_TICKS = 15;

/** Break healing support before shooting the troops it can keep alive. */
export function mountedTargetOrder(a: Unit, b: Unit) {
  const heals = (unit: Unit) => unitAbilities(unit).some(ability => ABILITY_DEFS[ability].behavior === 'heal');
  return Number(heals(b)) - Number(heals(a)) || a.hp - b.hp;
}

function reach(foe: Threat, rider: Unit, horizon: number) {
  if (!('order' in foe)) return foe.attackRange + rider.radius;
  const weaponReach = foe.attackRange <= 80 ? foe.attackRange + foe.radius + rider.radius : foe.attackRange;
  return Math.max(weaponReach, ...unitAbilities(foe).flatMap(ability => {
    const rules = ABILITY_DEFS[ability];
    return ['charge', 'stomp', 'web', 'curse', 'weapon'].includes(rules.behavior)
      && abilityCooldown(foe, ability) <= horizon ? [rules.range] : [];
  }));
}

/** One ordinary command per think; ranges and cooldowns come from the live combatants. */
export function mountedMicro(snapshot: GameSnapshot, rider: Unit, target: Unit, foes: readonly Threat[], goal: { kind: 'camp' } | { kind: 'raid'; station: Point }): GameCommand {
  const aim = rider.aim ? rider.aim : rider;
  // While the weapon cannot fire this turn, only commit to waiting until the next think.
  const shot = rider.cooldown > THINK_TICKS ? 0 : rider.cooldown / SIM_TICKS_PER_SECOND + distance(aim, target) / aimingProfile(UNIT_DEFS.horseArcher)!.speed;
  const horizon = THINK_TICKS + rider.cooldown;
  const margin = (point: Point, foe: Threat) => distance(point, foe) - reach(foe, rider, horizon);
  const safeShot = foes.every(foe => margin(rider, foe) > ('order' in foe ? foe.speed : 0) * (THINK_TICKS / SIM_TICKS_PER_SECOND + shot));
  if (safeShot) {
    if (distance(rider, target) <= rider.attackRange) {
      // A fleeing worker or leashing creep must not pull an attack order back under cover.
      return goal.kind === 'camp' || target.order.type === 'attack' && target.order.targetId === rider.id
        ? { type: 'attack', unitIds: [rider.id], targetId: target.id }
        : { type: 'aim', unitIds: [rider.id], x: target.x, y: target.y };
    }
    if (!foes.some(foe => 'order' in foe && foe.order.type === 'attack' && foe.order.targetId === rider.id)) {
      return goal.kind === 'camp' ? { type: 'attack', unitIds: [rider.id], targetId: target.id }
        : mountedEscape(snapshot, rider, foes, 0, steerPoint(snapshot.map, rider, goal.station));
    }
    return { type: 'holdPosition', unitIds: [rider.id] };
  }
  const edge = Math.min(rider.x, rider.y, snapshot.map.width - rider.x, snapshot.map.height - rider.y);
  return mountedEscape(snapshot, rider, foes, shot, goal.kind === 'raid' && edge < rider.attackRange
    ? { x: snapshot.map.width / 2, y: snapshot.map.height / 2 } : undefined);
}

export function mountedEscape(snapshot: GameSnapshot, rider: Unit, foes: readonly Threat[], shot: number, destination: Point | undefined): GameCommand {
  const horizon = THINK_TICKS + rider.cooldown;
  const threats = foes.map(foe => ({ foe, range: reach(foe, rider, horizon), speed: 'order' in foe ? foe.speed : 0 }));
  const margin = (point: Point, threat: typeof threats[number]) => distance(point, threat.foe) - threat.range;
  const danger = [...threats].sort((a, b) => margin(rider, a) - a.speed * (THINK_TICKS / SIM_TICKS_PER_SECOND + shot)
    - (margin(rider, b) - b.speed * (THINK_TICKS / SIM_TICKS_PER_SECOND + shot)))[0]!;
  const angle = destination ? Math.atan2(destination.y - rider.y, destination.x - rider.x) : Math.atan2(rider.y - danger.foe.y, rider.x - danger.foe.x);
  const step = rider.speed * THINK_TICKS / SIM_TICKS_PER_SECOND;
  const choices = [rider, ...Array.from({ length: 16 }, (_, index) => ({
    x: rider.x + detCos(angle + index * Math.PI / 8) * step,
    y: rider.y + detSin(angle + index * Math.PI / 8) * step,
  })).filter(point => point.x >= 0 && point.y >= 0 && point.x < snapshot.map.width && point.y < snapshot.map.height
    && isWalkable(snapshot.map, point.x, point.y)
    && segmentWalkable(snapshot.map, rider, point))];
  // Leave room for the following turn rather than maximizing distance into a cliff corner.
  const exit = (point: Point) => point !== rider && segmentWalkable(snapshot.map, point,
    { x: point.x + (point.x - rider.x), y: point.y + (point.y - rider.y) });
  const scored = choices.map(point => {
    const margins = threats.map(threat => margin(point, threat));
    const room = Math.min(...margins.map((gap, index) => gap - threats[index]!.speed * THINK_TICKS / SIM_TICKS_PER_SECOND));
    return { point, room, margin: Math.min(...margins), exit: room > 0 && !destination && exit(point),
      distance: destination ? distance(point, destination) : 0 };
  });
  const chosen = scored.sort((a, b) => Number(b.room > 0) - Number(a.room > 0)
    || (a.room > 0 ? destination ? a.distance - b.distance
      : Number(b.exit) - Number(a.exit) || b.margin - a.margin : b.room - a.room))[0]!;
  return { type: 'move', unitIds: [rider.id], x: chosen.point.x, y: chosen.point.y };
}
