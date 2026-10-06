import { itemIndex } from "./item-index";
import { strikePoint, type StrikeTarget } from "./combat-geometry";
import { detCos, detSin } from "./det-math";
import { type WeaponDef } from './catalog';
import { SHIP_KINDS, localToWorld, shipProfile, shipScale, worldToLocal, type Point } from './ship-geometry';
import { headingDifference } from "./ship-navigation";
import { seconds } from './time';
import type { GameSnapshot, ShipEquipmentKind, Unit, WorldItem } from './types';
export const SHIP_HULL_COST = { cutter: 120, transport: 160, warship: 170, bombardShip: 240, fireShip: 190, carrier: 280 } as const;
export const SHIP_WEAPONS: Record<ShipEquipmentKind, {
    cost: number;
    mass: number;
    hp: number;
    damage: number;
    range: number;
    cooldown: number;
    aimSpeed: number;
    weapon: WeaponDef;
    art: 'warship' | 'bombardShip' | 'fireShip';
}> = {
    shipCannon: { cost: 220, mass: 160, hp: 90, damage: 20, range: 312, cooldown: seconds(2), aimSpeed: 440, weapon: { presentation:'cannon', delivery: 'bolt', radius: 8, blastRadius: 48, maxHits: 1, navalMultiplier: 2, hullDamageShare: 1.25 }, art: 'warship' },
    shipMortar: { cost: 330, mass: 240, hp: 100, damage: 36, range: 576, cooldown: seconds(3.6), aimSpeed: 400, weapon: { presentation:'mortar', delivery: 'shell', radius: 75, minRange: 180, buildingMultiplier: 2, navalMultiplier: 1.7, hullDamageShare: 1.5 }, art: 'bombardShip' },
    flameProjector: { cost: 180, mass: 120, hp: 80, damage: 10, range: 144, cooldown: seconds(1.2), aimSpeed: 480, weapon: { presentation:'flame', delivery: 'cone', coneAngle: .85, buildingMultiplier: .7 }, art: 'fireShip' },
};
/** Bow guns traverse ±30°; broadside guns traverse ±35° around their own side. */
export function shipMounts(ship: Unit) {
    const p = shipProfile(ship);
    if (!p)
        return [];
    const scale = shipScale(ship);
    const mount = (id: string, x: number, y: number, bearing: number, halfArc: number, accepts: ShipEquipmentKind[]) => ({ id, x: x * scale, y: y * scale, radius: 12 * scale, bearing, halfArc, accepts });
    const all: ShipEquipmentKind[] = ['shipCannon', 'shipMortar', 'flameProjector'];
    const bow = (x: number, accepts = all) => mount('bow', x, 0, 0, Math.PI / 6, accepts);
    if (ship.kind === 'cutter')
        return [bow(28, ['shipCannon'])];
    if (ship.kind === 'transport')
        return [bow(32, ['shipCannon', 'flameProjector'])];
    const side: ShipEquipmentKind[] = ['shipCannon', 'flameProjector'];
    const positions = ship.kind === 'carrier' ? [35, 0, -35] : ship.kind === 'warship' ? [15, -15] : [-10];
    const breadth = ship.kind === 'carrier' ? 38 : 23;
    return [bow(ship.kind === 'carrier' ? 80 : p.weaponPivot![0]! / scale), ...positions.flatMap((x, i) => [
            mount(`port${i}`, x, -breadth, -Math.PI / 2, 35 * Math.PI / 180, side),
            mount(`starboard${i}`, x, breadth, Math.PI / 2, 35 * Math.PI / 180, side),
        ])];
}
export function shipGunCanAim(ship: Unit, item: WorldItem, target: StrikeTarget) {
    const mount = shipMounts(ship).find(mount => mount.id === item.mountId);
    if (!mount)
        return false;
    const pivot = localToWorld(ship, mount), point = strikePoint(pivot, target), angle = Math.atan2(point.y - pivot.y, point.x - pivot.x);
    return Math.abs(headingDifference((ship.sailing?.heading ?? 0) + mount.bearing, angle)) <= mount.halfArc + 1e-7;
}
/** An attack order chooses the broadside with the most working guns, then the shortest turn. */
export function bestFiringHeading(snapshot: Pick<GameSnapshot, 'items'>, ship: Unit, point: StrikeTarget) {
    const weapons = installedWeapons(snapshot, ship).filter(item => (item.durability ?? 1) > 0), heading = ship.sailing?.heading ?? 0, angle = Math.atan2(point.y - ship.y, point.x - ship.x);
    const mounts = shipMounts(ship).filter(mount => weapons.some(item => item.mountId === mount.id));
    let best = heading, score = -Infinity;
    for (const candidate of [heading, ...mounts.map(mount => angle - mount.bearing)]) {
        const pose = { ...ship, sailing: { ...ship.sailing!, heading: candidate } };
        const count = weapons.filter(item => {
            const profile=SHIP_WEAPONS[item.kind as ShipEquipmentKind],pivot=mountedWeaponPose(pose,item)!.pivot,aim=strikePoint(pivot,point),gap=Math.hypot(aim.x-pivot.x,aim.y-pivot.y);
            return gap<=profile.range && gap>=(profile.weapon.minRange ?? 0) && shipGunCanAim(pose,item,point);
        }).length;
        const value = count * 10 - Math.abs(headingDifference(heading, candidate));
        if (value > score) {
            score = value;
            best = candidate;
        }
    }
    return best;
}
export function isShipEquipment(kind: WorldItem['kind']): kind is ShipEquipmentKind { return kind in SHIP_WEAPONS; }
export function installedWeapons(snapshot: {
    items: readonly WorldItem[];
}, ship: Unit) { return (itemIndex(snapshot.items).byShip.get(ship.id) ?? []).filter(item => item.mountId && isShipEquipment(item.kind)); }
export function shipPartMax(ship: Unit) { const p = shipProfile(ship)!; return { rigging: Math.round(p.length * .55), rudder: Math.round(p.beam * .8) }; }
export function initializeShipEquipment(snapshot: GameSnapshot) {
    for (const ship of snapshot.units) {
        if (!SHIP_KINDS.includes(ship.kind as never))
            continue;
        ship.shipParts ??= { ...shipPartMax(ship) };
        if (ship.fittings)
            continue;
        ship.fittings = [];
        const kind: ShipEquipmentKind | undefined = ship.kind === 'warship' ? 'shipCannon' : ship.kind === 'bombardShip' ? 'shipMortar' : ship.kind === 'fireShip' ? 'flameProjector' : undefined;
        if (kind) {
            const def = SHIP_WEAPONS[kind];
            const item: WorldItem = { id: `mounted-${ship.id}`, kind, x: ship.x, y: ship.y, shipId: ship.id, mountId: 'bow', durability: def.hp, cooldownRemaining: ship.cooldown };
            snapshot.items.push(item);
            ship.fittings.push({ ...shipMounts(ship)[0]!, id: item.id });
        }
    }
}
/** Portable weapons keep their state when moved; the mount supplies only position. */
export function mountedWeaponPose(ship: Unit, item: WorldItem) {
    const mount = shipMounts(ship).find(mount => mount.id === item.mountId);
    if (!mount || !isShipEquipment(item.kind))
        return undefined;
    const def = SHIP_WEAPONS[item.kind], p = shipProfile(ship)!, pivot = localToWorld(ship, mount), axis = (ship.sailing?.heading ?? 0) + mount.bearing, heading = axis + Math.max(-mount.halfArc, Math.min(mount.halfArc, headingDifference(axis, item.facing ?? axis)));
    const native = item.mountId === 'bow' && def.art === ship.kind && p.weaponPivot && p.weaponMount;
    const height = native ? p.weaponMount![2]! : p.deckHeight + 9;
    const reach = native ? p.weaponMount![0]! - p.weaponPivot![0]! : item.kind === 'shipMortar' ? 8 : 26;
    return { pivot, pivotHeight: native ? p.weaponPivot![2]! : p.deckHeight + 2, heading, muzzle: { x: pivot.x + detCos(heading) * reach, y: pivot.y + detSin(heading) * reach }, height, art: def.art };
}
export function rebuildShipFittings(snapshot: GameSnapshot, ship: Unit) {
    ship.fittings = installedWeapons(snapshot, ship).map(item => ({ ...shipMounts(ship).find(mount => mount.id === item.mountId)!, id: item.id }));
}
export function shipNeedsRepair(snapshot: Pick<GameSnapshot, 'items'>, ship: Unit) { const max = shipPartMax(ship); return ship.hp < ship.maxHp || (ship.shipParts?.rigging ?? max.rigging) < max.rigging || (ship.shipParts?.rudder ?? max.rudder) < max.rudder || installedWeapons(snapshot, ship).some(item => (item.durability ?? SHIP_WEAPONS[item.kind as ShipEquipmentKind].hp) < SHIP_WEAPONS[item.kind as ShipEquipmentKind].hp); }
export function repairShipParts(snapshot: Pick<GameSnapshot, 'items'>, ship: Unit, amount: number) {
    const max = shipPartMax(ship);
    ship.shipParts ??= { ...max };
    const repair = (key: 'rigging' | 'rudder') => { const healed = Math.min(amount, max[key] - ship.shipParts![key]); ship.shipParts![key] += healed; amount -= healed; };
    // Restore propulsion and steering before an otherwise sound hull.
    for (const key of ['rigging', 'rudder'] as const)
        if (ship.shipParts[key] <= 0)
            repair(key);
    const hull = Math.min(amount, ship.maxHp - ship.hp);
    ship.hp += hull;
    amount -= hull;
    for (const key of ['rigging', 'rudder'] as const)
        repair(key);
    for (const item of installedWeapons(snapshot, ship)) {
        const hp = SHIP_WEAPONS[item.kind as ShipEquipmentKind].hp;
        const healed = Math.min(amount, hp - (item.durability ?? hp));
        item.durability = (item.durability ?? hp) + healed;
        amount -= healed;
    }
}
/** Physical hit regions affect fittings; a random debuff roll is never involved. */
export function damageShipParts(snapshot: Pick<GameSnapshot, 'items'>, ship: Unit, impact: Point, damage: number, radius = 0) {
    const profile = shipProfile(ship)!, local = worldToLocal(ship, impact), max = shipPartMax(ship);
    ship.shipParts ??= { ...max };
    const mast = profile.obstacles.find(o => o.type === 'mast');
    if (mast && Math.hypot(local.x - mast.x, local.y - mast.y) <= mast.radius + radius + 8)
        ship.shipParts.rigging = Math.max(0, ship.shipParts.rigging - damage * .65);
    if (Math.hypot(local.x + profile.length / 2 - 5, local.y) <= profile.beam * .22 + radius)
        ship.shipParts.rudder = Math.max(0, ship.shipParts.rudder - damage * .8);
    for (const item of installedWeapons(snapshot, ship)) {
        const mount = shipMounts(ship).find(mount => mount.id === item.mountId)!;
        if (Math.hypot(local.x - mount.x, local.y - mount.y) <= mount.radius + radius)
            item.durability = Math.max(0, (item.durability ?? SHIP_WEAPONS[item.kind as ShipEquipmentKind].hp) - damage * .65);
    }
}
