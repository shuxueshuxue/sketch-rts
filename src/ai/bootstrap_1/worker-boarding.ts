import { weaponRules } from '../../shared/equipment';
import { workingWeaponGeometry } from '../../shared/combat-fire-geometry';
import { canBoard } from '../../shared/decks';
import { alongside, boardingBerth, canReach } from '../../shared/naval';
import { groundSteeringRoute } from '../../shared/route-selection';
import { installedWeapons, mountedWeaponPose, SHIP_WEAPONS } from '../../shared/ship-equipment';
import { shipProfile, type Point } from '../../shared/ship-geometry';
import { walkDestination } from '../../shared/terrain';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { veteranWeaponRange } from '../../shared/veteran-stats';
import { isEnemyOwner } from '../policy/ownership';
import type { AiPolicyContext } from '../policy/types';

type Coverage = { origin: Point; range: number; minimum: number; reaches: (point: Point) => boolean };

/** Probe the nearest point and any minimum-range boundary on a real road segment. */
function entersCoverage(a: Point, b: Point, coverage: Coverage) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const projection = length ? ((coverage.origin.x - a.x) * dx + (coverage.origin.y - a.y) * dy) / length : 0;
  const samples = [0, 1, Math.max(0, Math.min(1, projection))];
  if (coverage.minimum > 0 && length) {
    const x = a.x - coverage.origin.x, y = a.y - coverage.origin.y;
    const middle = x * dx + y * dy, discriminant = middle * middle - length * (x * x + y * y - coverage.minimum * coverage.minimum);
    if (discriminant >= 0) for (const sign of [-1, 1]) {
      const t = (-middle + sign * Math.sqrt(discriminant)) / length;
      if (t >= 0 && t <= 1) samples.push(t);
    }
  }
  return samples.some(t => {
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const gap = Math.hypot(point.x - coverage.origin.x, point.y - coverage.origin.y);
    return gap <= coverage.range && gap + 1e-7 >= coverage.minimum && coverage.reaches(point);
  });
}

function weaponCoverage(snapshot: GameSnapshot, foe: Unit | Building, worker: Unit): Coverage[] {
  if (!('order' in foe)) return foe.complete && foe.attackDamage > 0
    ? [{ origin: foe, range: foe.attackRange, minimum: 0, reaches: () => true }] : [];
  const rules = weaponRules(snapshot, foe), ship = shipProfile(foe);
  const reaches = (point: Point, range: number) => canReach(snapshot.map, foe, { ...worker, ...point }, snapshot.units, range);
  const intrinsic = foe.attackDamage > 0 && (!ship || rules.intrinsicAttack) ? [{
    origin: foe, range: ship ? veteranWeaponRange(foe, rules.attackRange) : foe.attackRange,
    minimum: rules.weapon?.minRange ?? 0,
    reaches: (point: Point) => reaches(point, ship ? veteranWeaponRange(foe, rules.attackRange) : foe.attackRange),
  }] : [];
  return [...intrinsic, ...(ship ? installedWeapons(snapshot, foe).flatMap(item => {
    if ((item.durability ?? 1) <= 0) return [];
    const pose = mountedWeaponPose(foe, item);
    if (!pose) return [];
    const weapon = SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS], range = veteranWeaponRange(foe, weapon.range);
    // A waiting passenger cannot rely on a battery continuing to face away.
    // Cover its real pivot's whole annulus instead of sampling a hard aim arc.
    return [{ origin: pose.pivot, range, minimum: weapon.weapon.minRange ?? 0,
      reaches: () => true }];
  }) : [])];
}

/** The native shore, not the ferry's coarse source, owns a shore passenger's actual road and wait. */
export function passengerBoardingSafe(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, worker: Unit, boat: Unit) {
  if (worker.deck || worker.cabin
    || alongside(worker, boat) && canBoard(boat, worker, snapshot.units)) return true;
  if (snapshot.projectiles.some(projectile => projectile.targetId === worker.id && projectile.damage > 0
    && isEnemyOwner(snapshot, owner, projectile.owner, options))) return false;
  const current = worker.order.type === 'board' && worker.order.transportId === boat.id ? worker.order.berth : undefined;
  const shared = snapshot.units.find(unit => unit.order.type === 'board' && unit.order.transportId === boat.id);
  const berth = current ?? (shared?.order.type === 'board' ? shared.order.berth : undefined)
    ?? boardingBerth(snapshot.map, worker, boat);
  if (!berth) return true;
  const shore = walkDestination(snapshot.map, worker, berth.shore ?? berth);
  const road = groundSteeringRoute(snapshot.map, worker, shore);
  const foes = [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0
    && isEnemyOwner(snapshot, owner, foe.owner, options));
  return !foes.some(foe => weaponCoverage(snapshot, foe, worker).some(coverage =>
    road.some((point, index) => entersCoverage(road[Math.max(0, index - 1)]!, point, coverage))));
}

/** A new worker rendezvous stops a moving ferry. Preserve an existing escape
 * while a hostile working weapon covers its current target or a shot is
 * already flying at the hull. This does not promise the old road is safe. */
export function canPauseFerryForWorker(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, boat: Unit) {
  if (boat.order.type !== 'move' || !boat.order.avoidCombat) return true;
  if (snapshot.projectiles.some(projectile => projectile.targetId === boat.id && projectile.damage > 0
    && isEnemyOwner(snapshot, owner, projectile.owner, options))) return false;
  return !snapshot.units.some(foe => {
    if (foe.hp <= 0 || !isEnemyOwner(snapshot, owner, foe.owner, options)) return false;
    const targeting = (foe.order.type === 'attack' || foe.order.type === 'attackMove') && foe.order.targetId === boat.id
      || foe.sailing?.pursuit?.targetId === boat.id;
    return targeting && workingWeaponGeometry(snapshot, foe, boat).some(weapon => weapon.covers);
  });
}
