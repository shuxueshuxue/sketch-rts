import { shipPartMax } from './ship-handling';
export { shipPartMax } from './ship-handling';
import { itemIndex } from "./item-index";
import { strikePoint, type StrikeTarget } from "./combat-geometry";
import { detCos, detSin } from "./det-math";
import { type WeaponDef } from './catalog';
import { SHIP_KINDS, localToWorld, shipProfile, shipScale, worldToLocal, type Point } from './ship-geometry';
import { headingDifference } from "./ship-navigation";
import { seconds } from './time';
import type { GameSnapshot, ShipEquipmentKind, Unit, WorldItem } from './types';
import { veteranWeaponRange } from './veteran-stats';
import { ballisticTarget, ballisticTargetPredictor, firingBoundaryHeadings, shipFireLaneClear, targetSailingVelocity } from './ship-fire-control';
import geometry from './generated/ship-geometry.json';
// Complete trained ships cost about 40% more, rounded to 20 gold; troop hulls
// cost 50% more for their larger compartment. Included guns retain item prices.
export const SHIP_HULL_COST = { cutter: 160, transport: 240, warship: 320, bombardShip: 470, fireShip: 340, carrier: 420, shipOfTheLine: 1080 } as const;
/** Prices paid by unfinished jobs in saves written before paidGold was recorded. */
export const PREVIOUS_SHIP_TRAIN_COST = { cutter:120, transport:160, warship:390, bombardShip:570, fireShip:370, carrier:280, shipOfTheLine:1400 } as const;
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
    const profile=shipProfile(ship);
    if(!profile)return [];
    let mounts=mountProfiles.get(profile);
    if(!mounts){
        const computed=computeShipMounts(ship);
        for(const mount of computed){Object.freeze(mount.accepts);Object.freeze(mount);}
        mounts=Object.freeze(computed);mountProfiles.set(profile,mounts);
    }
    return mounts;
}
// Local profiles are immutable and replaced when kind, scale or fittings
// change. Posed hulls share them, so traversing guns reuse the same catalogue.
const mountProfiles=new WeakMap<NonNullable<ReturnType<typeof shipProfile>>,Readonly<ReturnType<typeof computeShipMounts>>>();
function computeShipMounts(ship: Unit) {
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
    if (ship.kind === 'shipOfTheLine') {
        const positions = [[-74, 53], [-32, 54], [10, 53], [50, 48.9]];
        return positions.flatMap(([x, breadth], i) => [
            mount(`port${i}`, x!, -breadth!, -Math.PI / 2, 35 * Math.PI / 180, ['shipCannon']),
            mount(`starboard${i}`, x!, breadth!, Math.PI / 2, 35 * Math.PI / 180, ['shipCannon']),
        ]);
    }
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
/** Bring a working gun into its arc with the least hull rotation. A gun
 * already able to fire never gives up its shot just to align a larger battery. */
/** A synchronous, deterministic read-only lane query. Selection may reuse,
 * omit or reorder identical queries when a candidate cannot win. */
export type MountedShotClear = (item: WorldItem, point: Point, heading: number) => boolean;
export function bestFiringHeading(snapshot: Pick<GameSnapshot, 'items'> & Partial<Pick<GameSnapshot, 'units'>>, ship: Unit, point: StrikeTarget, arcMargin = 0, shotClear?: MountedShotClear) {
    const weapons=installedWeapons(snapshot,ship).filter(item=>(item.durability ?? 1)>0);
    const heading=ship.sailing?.heading ?? 0;
    const mounts=new Map(shipMounts(ship).map(mount=>[mount.id,mount]));
    const velocity=targetSailingVelocity(point,snapshot.units),moving=Math.hypot(velocity.x,velocity.y)>1e-7;
    const speed=Math.hypot(velocity.x,velocity.y),surface=strikePoint(ship,point),gap=Math.hypot(surface.x-ship.x,surface.y-ship.y);
    const possible=(item:WorldItem)=>{
        const mount=mounts.get(item.mountId!)!;if(!mount)return false;
        const def=SHIP_WEAPONS[item.kind as ShipEquipmentKind],range=veteranWeaponRange(ship,def.range);
        const flight=def.weapon.delivery==='cone'?0:Math.max(.2,range/(def.weapon.delivery==='shell'?240:560)+.05);
        return gap<=range+Math.hypot(mount.x,mount.y)+speed*flight;
    };
    if(!weapons.some(possible))return heading;
    const reaches=new Map(weapons.map(item=>{const pose=mountedWeaponPose(ship,item)!;return[item.id,Math.hypot(pose.muzzle.x-pose.pivot.x,pose.muzzle.y-pose.pivot.y)];}));
    const predict=ballisticTargetPredictor(point,velocity);
    const predictions=new Map<string,Map<number,{target:StrikeTarget;point?:Point;eligible?:boolean;clear?:boolean}>>();
    const targetAt=(candidate:number,item:WorldItem)=>{
        let cache=predictions.get(item.id);if(!cache){cache=new Map();predictions.set(item.id,cache);}
        const cached=cache.get(candidate);if(cached)return cached.target;
        const mount=mounts.get(item.mountId!)!,c=detCos(candidate),s=detSin(candidate);
        const pivot={x:ship.x+mount.x*c-mount.y*s,y:ship.y+mount.x*s+mount.y*c};
        const predicted=predict(pivot,SHIP_WEAPONS[item.kind as ShipEquipmentKind].weapon,reaches.get(item.id)!);cache.set(candidate,{target:predicted});return predicted;
    };
    const canFire=(candidate:number,item:WorldItem,checkLane=true)=>{
        const mount=mounts.get(item.mountId!)!;if(!mount)return false;
        const predicted=targetAt(candidate,item),check=predictions.get(item.id)!.get(candidate)!;
        // Boundaries, admission and battery counts ask the same question.
        // Cache only within this fixed pose/target/blocker selection; no
        // verdict survives a movement step or a later heading selection.
        if(check.eligible===undefined){
            const def=SHIP_WEAPONS[item.kind as ShipEquipmentKind],c=detCos(candidate),s=detSin(candidate);
            const pivot={x:ship.x+mount.x*c-mount.y*s,y:ship.y+mount.x*s+mount.y*c};
            const target=strikePoint(pivot,predicted),gap=Math.hypot(target.x-pivot.x,target.y-pivot.y);
            check.point=target;
            check.eligible=gap<=veteranWeaponRange(ship,def.range) && gap>=(def.weapon.minRange ?? 0)
              && Math.abs(headingDifference(candidate+mount.bearing,Math.atan2(target.y-pivot.y,target.x-pivot.x)))<=Math.max(0,mount.halfArc-arcMargin)+1e-7;
        }
        if(!check.eligible)return false;
        if(!checkLane || !shotClear)return true;
        return check.clear ??= shotClear(item,check.point!,candidate);
    };
    const batteryCount=(candidate:number)=>{let count=0;for(const gun of weapons)if(canFire(candidate,gun))count++;return count;};
    const currentCount=batteryCount(heading);
    if(currentCount===weapons.length)return heading;
    const nearbyBattery=Math.PI/18;
    const candidates:{heading:number;turn:number;count?:number}[]=currentCount?[{heading,turn:0,count:currentCount}]:[];
    let nearestTurn=currentCount?0:Infinity;
    const intervals=[-Math.PI,0,Math.PI];
    for(const item of weapons){
        const mount=mounts.get(item.mountId!)!;
        if(!mount || !possible(item))continue;
        const def=SHIP_WEAPONS[item.kind as ShipEquipmentKind];
        if(currentCount){
            const pose=mountedWeaponPose(ship,item)!,target=strikePoint(pose.pivot,targetAt(heading,item));
            const gap=Math.hypot(target.x-pose.pivot.x,target.y-pose.pivot.y);
            const pivotTravel=2*Math.hypot(mount.x,mount.y)*Math.sin(nearbyBattery/2);
            const projectileSpeed=def.weapon.delivery==='shell'?240:def.weapon.delivery==='bolt'?560:Infinity;
            const leadTravel=projectileSpeed===Infinity?0:speed*pivotTravel/Math.max(1,projectileSpeed-speed)+speed/20;
            const change=pivotTravel+leadTravel;
            const angleChange=gap>change?Math.asin(change/gap):Math.PI;
            const bearing=Math.abs(headingDifference(heading+mount.bearing,Math.atan2(target.y-pose.pivot.y,target.x-pose.pivot.x)));
            // Once a gun can fire, battery coordination only permits a small
            // turn. Skip a fitting which cannot enter that window even after
            // accounting for pivot travel and a one-tick change in its lead.
            if(bearing>Math.max(0,mount.halfArc-arcMargin)+nearbyBattery+angleChange+1e-7)continue;
        }
        // This selection fixes the target shape/heading and mount. Ballistic
        // prediction only translates x/y, often to the same discrete flight
        // time. Keep signed zero distinct; future turning predictions would
        // also need their heading in this bounded, call-local cache key.
        const boundaryCache:{x:number;y:number;values:number[]}[]=[];
        const boundaries=(at:number)=>{
            const predicted=targetAt(at,item);
            for(const cached of boundaryCache)if(Object.is(cached.x,predicted.x) && Object.is(cached.y,predicted.y))return cached.values;
            const values=firingBoundaryHeadings(ship,mount,predicted,mount.bearing,Math.max(0,mount.halfArc-arcMargin),def.weapon.minRange ?? 0,veteranWeaponRange(ship,def.range));
            if(boundaryCache.length===32)boundaryCache.shift();
            boundaryCache.push({x:predicted.x,y:predicted.y,values});return values;
        };
        for(const boundary of boundaries(heading)){
            let at=heading+headingDifference(heading,boundary);
            // Rotating a bow pivot changes the exact flight duration. Refine
            // its firing boundary against that mount's own predicted target.
            if(moving && !canFire(at,item,false))for(let step=0;step<6;step++){
                let next:number|undefined,nearest=Infinity;
                for(const boundary of boundaries(at)){
                    const turn=Math.abs(headingDifference(at,boundary));
                    if(turn<nearest){nearest=turn;next=boundary;}
                }
                if(next===undefined)break;
                const difference=headingDifference(at,next);at+=difference;
                if(Math.abs(difference)<1e-10)break;
            }
            if(shotClear)intervals.push(headingDifference(heading,at));
            // A farther accepted shot cannot enter the final battery window,
            // whose nearest turn only decreases. Preserve boundary refinement
            // and interval collection; reject only when all three possible
            // exact heading inputs are already dominated.
            const window=nearestTurn+nearbyBattery;
            if(Math.abs(headingDifference(heading,at))>window
              && Math.abs(headingDifference(heading,at-1e-8))>window
              && Math.abs(headingDifference(heading,at+1e-8))>window)continue;
            // A range boundary may round to the wrong side of the exact shot
            // check. Test its immediate interiors, never widen weapon range.
            for(const candidate of canFire(at,item)?[at]:[at-1e-8,at+1e-8]){
                const turn=Math.abs(headingDifference(heading,candidate));
                if(turn>nearestTurn+nearbyBattery || !canFire(candidate,item))continue;
                candidates.push({heading:candidate,turn});
                nearestTurn=Math.min(nearestTurn,turn);
            }
        }
    }
    if(shotClear && !candidates.length){
        // Friendly hulls can block both ends of an otherwise useful firing
        // interval. Arc/range boundaries alone do not describe those lanes.
        // Search a bounded set of interiors only when no existing shot works;
        // the ordinary unblocked heading path retains its analytic solution.
        const edges=[...new Set(intervals)].sort((a,b)=>a-b);
        const sectors=edges.slice(1).map((end,index)=>({start:edges[index]!,end}))
          .filter(sector=>sector.end-sector.start>1e-7)
          .sort((a,b)=>Math.min(Math.abs(a.start),Math.abs(a.end))-Math.min(Math.abs(b.start),Math.abs(b.end)));
        let samples=0,bestTurn=Infinity;
        interiorSearch:for(const share of [.5,.25,.75]){
            for(const sector of sectors){
                const nearer=Math.abs(sector.start)<Math.abs(sector.end)?sector.start:sector.end;
                if(Math.abs(nearer)>bestTurn+nearbyBattery)continue;
                if(samples++>=48)break interiorSearch;
                let clear=sector.start+(sector.end-sector.start)*share;
                if(!weapons.some(gun=>canFire(heading+clear,gun)))continue;
                let blocked=nearer;
                // Every accepted refinement remains a real clear shot. An
                // additional blocker may split this interval again; no range
                // or traverse predicate is weakened by the bounded search.
                for(let step=0;step<12;step++){
                    const middle=(blocked+clear)/2;
                    if(weapons.some(gun=>canFire(heading+middle,gun)))clear=middle;else blocked=middle;
                }
                candidates.push({heading:heading+clear,turn:Math.abs(clear)});
                bestTurn=Math.min(bestTurn,Math.abs(clear));
            }
            // Inspect every nearer interval once before spending the finite
            // budget on smaller quarters of already blocked intervals.
            if(candidates.length)break;
        }
    }
    let nearest=Infinity;
    for(const candidate of candidates)nearest=Math.min(nearest,candidate.turn);
    // Score batteries only after the nearest valid shot fixes the final
    // window. An earlier, farther shot cannot become the selected battery.
    // Stable iteration retains the first candidate on equal count and turn.
    let winner:{heading:number;turn:number;count:number}|undefined;
    for(const candidate of candidates){
        if(candidate.turn>nearest+nearbyBattery)continue;
        if(winner?.count===weapons.length && candidate.turn>=winner.turn)continue;
        const count=candidate.count ?? batteryCount(candidate.heading);
        if(!winner || count>winner.count || count===winner.count && candidate.turn<winner.turn)winner={...candidate,count};
    }
    return winner?.heading ?? heading;
}
export function isShipEquipment(kind: WorldItem['kind']): kind is ShipEquipmentKind { return kind in SHIP_WEAPONS; }
export function installedWeapons(snapshot: {
    items: readonly WorldItem[];
}, ship: Unit) { return (itemIndex(snapshot.items).byShip.get(ship.id) ?? []).filter(item => item.mountId && isShipEquipment(item.kind)); }
export function initializeShipEquipment(snapshot: GameSnapshot) {
    for (const ship of snapshot.units) {
        if (!SHIP_KINDS.includes(ship.kind as never))
            continue;
        ship.shipParts ??= { ...shipPartMax(ship) };
        ship.shipParts.cabin ??= shipPartMax(ship).cabin;
        if (ship.fittings)
            continue;
        ship.fittings = [];
        const kind: ShipEquipmentKind | undefined = ship.kind === 'warship' || ship.kind === 'shipOfTheLine' ? 'shipCannon' : ship.kind === 'bombardShip' ? 'shipMortar' : ship.kind === 'fireShip' ? 'flameProjector' : undefined;
        const mounts = ship.kind === 'shipOfTheLine'
            ? shipMounts(ship).filter(mount => ['port0', 'port2', 'starboard0', 'starboard2'].includes(mount.id))
            : shipMounts(ship).filter(mount => mount.id === 'bow');
        if (!kind) continue;
        for (const mount of mounts) {
            const def = SHIP_WEAPONS[kind];
            const id = ship.kind === 'shipOfTheLine' ? `mounted-${ship.id}-${mount.id}` : `mounted-${ship.id}`;
            const item: WorldItem = { id, kind, x: ship.x, y: ship.y, shipId: ship.id, mountId: mount.id, durability: def.hp, cooldownRemaining: ship.cooldown };
            snapshot.items.push(item);
            // Profiles cache by fittings identity; each new weapon must also
            // become an actual deck obstacle immediately after construction.
            ship.fittings = [...ship.fittings, { ...mount, accepts:[...mount.accepts], id: item.id }];
        }
    }
}
/** Portable weapons keep their state when moved; the mount supplies only position. */
export function mountedWeaponPose(ship: Unit, item: WorldItem) {
    const mount = shipMounts(ship).find(mount => mount.id === item.mountId);
    if (!mount || !isShipEquipment(item.kind))
        return undefined;
    const def = SHIP_WEAPONS[item.kind], p = shipProfile(ship)!, scale = shipScale(ship), pivot = localToWorld(ship, mount), axis = (ship.sailing?.heading ?? 0) + mount.bearing, heading = axis + Math.max(-mount.halfArc, Math.min(mount.halfArc, headingDifference(axis, item.facing ?? axis)));
    const native = item.mountId === 'bow' && def.art === ship.kind && p.weaponPivot && p.weaponMount;
    const model = geometry.ships[def.art], pivotHeight = native ? p.weaponPivot![2]! : p.deckHeight + 2 * scale;
    const height = native ? p.weaponMount![2]! : pivotHeight + (model.weaponMount[2]! - model.weaponPivot[2]!) * scale;
    const reach = native ? p.weaponMount![0]! - p.weaponPivot![0]! : (model.weaponMount[0]! - model.weaponPivot[0]!) * scale;
    return { pivot, pivotHeight, heading, muzzle: { x: pivot.x + detCos(heading) * reach, y: pivot.y + detSin(heading) * reach }, height, art: def.art };
}
/** Heading selection, aiming and launch share one predicted physical body. */
export function mountedTargetPoint(snapshot: Partial<Pick<GameSnapshot, 'units'>>, ship: Unit, item: WorldItem, target: StrikeTarget, pose=mountedWeaponPose(ship,item)!) {
    const def=SHIP_WEAPONS[item.kind as ShipEquipmentKind];
    const reach=Math.hypot(pose.muzzle.x-pose.pivot.x,pose.muzzle.y-pose.pivot.y);
    return strikePoint(pose.pivot,ballisticTarget(pose.pivot,target,targetSailingVelocity(target,snapshot.units),def.weapon,reach));
}
/** Test the muzzle after the independent barrel has traversed toward its
 * reticle. Alliance filtering belongs to the caller, not hull ownership. */
export function mountedFireLaneClear(ship: Unit, item: WorldItem, point: Point, blockers: readonly Unit[]) {
    const pose=mountedWeaponPose(ship,item);
    if(!pose)return false;
    const reach=Math.hypot(pose.muzzle.x-pose.pivot.x,pose.muzzle.y-pose.pivot.y);
    const dx=point.x-pose.pivot.x,dy=point.y-pose.pivot.y,length=Math.hypot(dx,dy) || 1;
    const muzzle={x:pose.pivot.x+dx/length*reach,y:pose.pivot.y+dy/length*reach};
    return shipFireLaneClear(muzzle,point,SHIP_WEAPONS[item.kind as ShipEquipmentKind].weapon,blockers,ship.id);
}
export function rebuildShipFittings(snapshot: GameSnapshot, ship: Unit) {
    ship.fittings = installedWeapons(snapshot, ship).map(item => {const mount=shipMounts(ship).find(mount => mount.id === item.mountId)!;return { ...mount,accepts:[...mount.accepts],id:item.id };});
}
export function shipNeedsRepair(snapshot: Pick<GameSnapshot, 'items'>, ship: Unit) { const max = shipPartMax(ship); return ship.hp < ship.maxHp || (ship.shipParts?.rigging ?? max.rigging) < max.rigging || (ship.shipParts?.rudder ?? max.rudder) < max.rudder || (ship.shipParts?.cabin ?? max.cabin) < max.cabin || installedWeapons(snapshot, ship).some(item => (item.durability ?? SHIP_WEAPONS[item.kind as ShipEquipmentKind].hp) < SHIP_WEAPONS[item.kind as ShipEquipmentKind].hp); }
export function repairShipParts(snapshot: Pick<GameSnapshot, 'items'>, ship: Unit, amount: number) {
    const max = shipPartMax(ship);
    ship.shipParts ??= { ...max };
    ship.shipParts.cabin ??= max.cabin;
    const repair = (key: 'rigging' | 'rudder' | 'cabin') => { const healed = Math.min(amount, max[key] - ship.shipParts![key]!); ship.shipParts![key] = ship.shipParts![key]! + healed; amount -= healed; };
    // Restore propulsion and steering before an otherwise sound hull.
    for (const key of ['rigging', 'rudder'] as const)
        if (ship.shipParts[key] <= 0)
            repair(key);
    const hull = Math.min(amount, ship.maxHp - ship.hp);
    ship.hp += hull;
    amount -= hull;
    for (const key of ['rigging', 'rudder', 'cabin'] as const)
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
    ship.shipParts.cabin ??= max.cabin;
    if (profile.obstacles.some(o => o.type === 'mast' && Math.hypot(local.x - o.x, local.y - o.y) <= o.radius + radius + 8))
        ship.shipParts.rigging = Math.max(0, ship.shipParts.rigging - damage * .65);
    if (Math.hypot(local.x + profile.length / 2 - 5, local.y) <= profile.beam * .22 + radius)
        ship.shipParts.rudder = Math.max(0, ship.shipParts.rudder - damage * .8);
    const cabin = profile.obstacles.find(o => o.type === 'cabin');
    if (cabin && max.cabin > 0 && Math.hypot(local.x - cabin.x, local.y - cabin.y) <= cabin.radius + radius + 8)
        ship.shipParts.cabin = Math.max(0, ship.shipParts.cabin - damage * .65);
    for (const item of installedWeapons(snapshot, ship)) {
        const mount = shipMounts(ship).find(mount => mount.id === item.mountId)!;
        if (Math.hypot(local.x - mount.x, local.y - mount.y) <= mount.radius + radius)
            item.durability = Math.max(0, (item.durability ?? SHIP_WEAPONS[item.kind as ShipEquipmentKind].hp) - damage * .65);
    }
}
