import { UNIT_DEFS } from './catalog';
import { strikeGap } from './combat-geometry';
import { detCos, detSin } from './det-math';
import { bestFiringHeading, installedWeapons, mountedWeaponPose, shipGunCanAim, shipMounts, SHIP_WEAPONS } from './ship-equipment';
import { shipProfile } from './ship-geometry';
import { hullFits, type ShipPose } from './ship-navigation';
import { isWalkable, sameGround } from './terrain';
import type { Building, GameSnapshot, ShipEquipmentKind, Unit } from './types';
import { veteranWeaponRange } from './veteran-stats';

type World = Pick<GameSnapshot, 'map' | 'items' | 'units'>;
type Target = Unit | Building;
type CachedStation = { terrain: object; cells: string; key: string; station: ShipPose | undefined };
const cache = new WeakMap<Unit, Map<string, CachedStation>>();

/** A bounded tactical search, not a proof of physical impossibility. Explicit
 * attacks remain available; automatic engagements need an actual firing pose.
 * Only terrain is considered here: passing traffic must not blacklist a coast.
 */
export function shoreFiringStation(world: World, ship: Unit, target: Target): ShipPose | undefined {
  const profile = shipProfile(ship);
  if (!profile) return undefined;
  const weapons = installedWeapons(world, ship).filter(item => (item.durability ?? 1) > 0);
  const intrinsic = UNIT_DEFS[ship.kind].intrinsicAttack;
  const mounts = shipMounts(ship).filter(mount => weapons.some(item => item.mountId === mount.id));
  const armedPose = (x: number, y: number): ShipPose | undefined => {
    const station = { ...ship, x, y, sailing: {...ship.sailing!,heading:0} };
    const bearing = Math.atan2(target.y-y,target.x-x);
    const headings = [bestFiringHeading(world, station, target), ...mounts.flatMap(mount =>
      [0, -.8, .8].map(fraction => bearing-mount.bearing+fraction*mount.halfArc))];
    for (const heading of headings) {
      const posed = {...station,sailing:{...ship.sailing!,heading}};
      const fires = weapons.some(item => {
        const pose=mountedWeaponPose(posed,item)!;
        const def=SHIP_WEAPONS[item.kind as ShipEquipmentKind];
        const gap=strikeGap(pose.pivot,target);
        return gap<=veteranWeaponRange(ship,def.range) && gap>=(def.weapon.minRange ?? 0) && shipGunCanAim(posed,item,target);
      });
      if (fires && hullFits(world.map,ship,{x,y,heading})) return {x,y,heading};
    }
    if (intrinsic && strikeGap(station, target) <= ship.attackRange) {
      const heading = Math.atan2(target.y-y, target.x-x);
      if (hullFits(world.map, ship, { x, y, heading })) return { x, y, heading };
    }
    return undefined;
  };
  const current = armedPose(ship.x, ship.y);
  if (current) return current;
  if (!weapons.length && !intrinsic) return undefined;
  const terrain = world.map.terrain;
  const key = [world.map.width, world.map.height, target.x, target.y, target.radius, 'order' in target, ship.kind,
    profile.length, profile.beam, ship.attackRange, ship.veteranSkill,
    ...weapons.map(item => `${item.kind}:${item.mountId}`)].join(':');
  const previous = cache.get(ship)?.get(target.id);
  if (terrain && previous?.terrain === terrain && previous.cells === terrain.cells && previous.key === key
    && (!previous.station || sameGround(world.map,ship,previous.station,'sea'))) return previous.station;
  const reach = Math.max(intrinsic ? ship.attackRange : 0,
    ...weapons.map(item => veteranWeaponRange(ship, SHIP_WEAPONS[item.kind as ShipEquipmentKind].range)));
  const pivot = Math.max(0, ...shipMounts(ship).filter(mount => weapons.some(item => item.mountId === mount.id)).map(mount => Math.hypot(mount.x, mount.y)));
  const wall = 'order' in target ? 0 : target.radius;
  let station: ShipPose | undefined;
  // Include the extended bow reach and shorter stations for narrow coves or
  // minimum-range weapons. Fixed bearings keep the cached search independent
  // of the approaching ship's location and heading.
  for (const fraction of [1, .9, .75, .5]) {
    const radius = (reach + pivot) * fraction + wall - 1;
    for (let i=0; i<48; i++) {
      const angle = i * Math.PI/24;
      const x=target.x+detCos(angle)*radius, y=target.y+detSin(angle)*radius;
      if (!isWalkable(world.map,x,y,'sea') || !sameGround(world.map,ship,{x,y},'sea')) continue;
      station=armedPose(x,y);
      if (station) break;
    }
    if (station) break;
  }
  if (terrain) {
    let entries=cache.get(ship);
    if (!entries) { entries=new Map();cache.set(ship,entries); }
    if (!entries.has(target.id) && entries.size>=16) entries.delete(entries.keys().next().value!);
    entries.set(target.id,{terrain,cells:terrain.cells,key,station});
  }
  return station;
}

export function automaticShoreTargetReachable(world: World, ship: Unit, target: Target): boolean {
  if (!shipProfile(ship) || !world.map.terrain || ('order' in target && (shipProfile(target) || target.deck || target.cabin))
    || isWalkable(world.map,target.x,target.y,'sea')) return true;
  return shoreFiringStation(world,ship,target) !== undefined;
}
