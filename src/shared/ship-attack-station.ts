import { unitRules } from './catalog';
import { aimingRange } from './aiming';
import { carryingHull, strikeGap } from './combat-geometry';
import { detCos, detSin } from './det-math';
import { weaponRules } from './equipment';
import { hypot2 } from './hypot';
import { shipTraffic } from './ship-avoidance';
import { bestFiringHeading, installedWeapons, mountedAttackRange, mountedFireLaneClear, mountedShotClear, mountedTargetPoint, mountedWeaponPose, SHIP_WEAPONS, shipGunCanAim } from './ship-equipment';
import { shareShipProfile, shipProfile } from './ship-geometry';
import { hullId, hullPassageClear } from './ship-navigation';
import { shipPursuitGoal } from './ship-pursuit';
import { isWalkable } from './terrain';
import type { Building, GameSnapshot, Obstacle, Unit } from './types';
import { veteranWeaponRange } from './veteran-stats';

type World = Pick<GameSnapshot, 'items' | 'variants' | 'map' | 'units'>;
type Target = Unit | Building | Obstacle;

/** A live windup may keep its present station, never admit a more distant future firing station. */
export function continuingShipAim(world: World, ship: Unit, target: Target, blockers: readonly Unit[]): boolean {
  const rules = unitRules(world, ship);
  if (rules.intrinsicAttack) {
    const range = aimingRange(ship.aim, ship.attackRange, target.id, rules.aimRangeBuffer);
    if (range > ship.attackRange && strikeGap(ship, target) <= range) return true;
  }
  return installedWeapons(world, ship).some(item => {
    if ((item.durability ?? 1) <= 0) return false;
    const def = SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS];
    const range = mountedAttackRange(ship, item, target.id);
    if (range <= veteranWeaponRange(ship, def.range)) return false;
    const pose = mountedWeaponPose(ship, item);
    const point = pose && mountedTargetPoint(world, ship, item, target, pose);
    return !!point && shipGunCanAim(ship, item, point)
      && hypot2(point.x - pose!.pivot.x, point.y - pose!.pivot.y) <= range
      && (!blockers.length || mountedFireLaneClear(ship, item, point, blockers));
  });
}

/** The actual navigator and target admission use the same fitted guns, muzzle
 * positions, range, traverse and swept turn. */
export function shipAttackStation(world: World, ship: Unit, ordered: Target, blockers: readonly Unit[]) {
  const weapons = installedWeapons(world, ship).filter(item => (item.durability ?? 1) > 0);
  const intrinsic = unitRules(world, ship).intrinsicAttack;
  const minimum = intrinsic ? 0 : weapons.length ? Math.min(...weapons.map(item => SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].weapon.minRange ?? 0))
    : weaponRules(world, ship).weapon?.minRange ?? 0;
  const target = minimum > 0 && 'order' in ordered ? carryingHull(ordered, world.units) ?? ordered : ordered;
  const firingPose = (station: Unit, checkTurn: boolean): { heading?: number } | undefined => {
    if (!weapons.length || intrinsic && strikeGap(station, target) <= station.attackRange)
      return strikeGap(station, target) <= station.attackRange && strikeGap(station, target) >= minimum ? {} : undefined;
    shareShipProfile(ship, station);
    const start = { x: station.x, y: station.y, heading: station.sailing!.heading };
    const shotClear = mountedShotClear(station, blockers);
    for (const margin of [Math.PI / 36, 0]) {
      const heading = bestFiringHeading(world, station, target, margin, shotClear);
      const aimed = { ...station, sailing: { ...station.sailing!, heading } }, end = { ...start, heading };
      shareShipProfile(ship, aimed);
      if (checkTurn && (!hullPassageClear(world.map, station, start, end) || !shipTraffic(station, world.units, 600, world.map)(start, end))) continue;
      if (weapons.some(item => {
        const pose = mountedWeaponPose(aimed, item), def = SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS];
        if (!pose) return false;
        const point = mountedTargetPoint(world, aimed, item, target, pose);
        if (!point || !shipGunCanAim(aimed, item, point)) return false;
        const gap = hypot2(pose.pivot.x - point.x, pose.pivot.y - point.y);
        return gap <= veteranWeaponRange(station, def.range) && gap >= (def.weapon.minRange ?? 0)
          && (!blockers.length || mountedFireLaneClear(aimed, item, point, blockers));
      })) return { heading };
    }
  };
  const bow = weapons.find(item => item.mountId === 'bow' && veteranWeaponRange(ship, SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].range) >= ship.attackRange);
  const bowPose = bow && mountedWeaponPose(ship, bow);
  const bowReach = bowPose ? (bowPose.pivot.x - ship.x) * detCos(ship.sailing!.heading) + (bowPose.pivot.y - ship.y) * detSin(ship.sailing!.heading) : 0;
  return { target, minimum, bowReach, firingPose };
}

const coastStations = new WeakMap<object, { cells: string; stations: Map<string, boolean> }>();

/** A point-sized sea walker can fit where a complete firing hull cannot.
 * For an inland target, require a station the actual pursuit search can use.
 * Temporary ships/buildings and friendly fire do not make a target permanently
 * unreachable; navigation still resolves them on the real approach. */
export function shipCanAttackCoastTarget(world: World, ship: Unit, target: Target): boolean {
  const terrain = world.map.terrain, profile = shipProfile(ship);
  if (!terrain || !profile || !ship.sailing || 'order' in target && (target.deck || target.cabin || shipProfile(target))
    || isWalkable(world.map, target.x, target.y, 'sea') || unitRules(world, ship).intrinsicAttack) return true;
  const weapons = installedWeapons(world, ship).filter(item => (item.durability ?? 1) > 0);
  if (!weapons.length) return true;
  let memo = coastStations.get(terrain);
  if (!memo || memo.cells !== terrain.cells) {
    memo = { cells: terrain.cells, stations: new Map() }; coastStations.set(terrain, memo);
  }
  const key = JSON.stringify([hullId(profile.hull), world.map.width, world.map.height, terrain.cell, terrain.cols, terrain.rows,
    ship.attackRange, target.x, target.y, target.radius, "order" in target, weapons.map(item => [item.mountId, item.kind, veteranWeaponRange(ship, SHIP_WEAPONS[item.kind as keyof typeof SHIP_WEAPONS].range)])]);
  const saved = memo.stations.get(key);
  if (saved) return true;
  // A ship already firing in a tight, oriented berth need not make a full
  // circle there. Retain a real shot even when no ordinary approach exists.
  if (shipAttackStation(world, ship, target, []).firingPose(ship, true)) return true;
  if (saved !== undefined) return saved;
  // A fixed bearing makes the terrain-only query independent of the live
  // ship's route, pursuit, neighbors and planning admission. No saved state
  // is mutated and no simulation navigation budget is consumed.
  const probe = { ...ship, x: target.x + ship.attackRange + profile.length * 2, y: target.y,
    sailing: { heading: Math.PI, speed: 0, load: ship.sailing.load, balance: ship.sailing.balance } };
  shareShipProfile(ship, probe);
  const geometry = shipAttackStation(world, probe, target, []);
  const goal = shipPursuitGoal(probe, target, [], ship.attackRange, geometry.minimum, false, () => false, world.map,
    undefined, geometry.bowReach, station => !!geometry.firingPose(station, false));
  const station = goal && { ...probe, x: goal.x, y: goal.y };
  const clear = !!station && hullPassageClear(world.map, station, { ...station, heading: 0 }, { ...station, heading: Math.PI })
    && hullPassageClear(world.map, station, { ...station, heading: Math.PI }, { ...station, heading: Math.PI * 2 })
    && !!geometry.firingPose(station, false);
  if (memo.stations.size >= 512) memo.stations.delete(memo.stations.keys().next().value!);
  memo.stations.set(key, clear);
  return clear;
}
