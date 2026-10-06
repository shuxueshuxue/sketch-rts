import type { WeaponDef } from "./catalog";
import { shipProfile, worldToLocal } from "./ship-geometry";
import { polygonPlanes } from "./navigation-math";
import type { Unit } from "./types";
export type WeaponPoint = {
    x: number;
    y: number;
    radius?: number;
};
/** Projection along a shot and distance from its centerline; no map-specific geometry. */
export function boltIntersection(from: WeaponPoint, to: WeaponPoint, target: WeaponPoint, width: number) {
    if ("order" in target) {
        const ship=target as Unit,profile=shipProfile(ship);
        if(profile){
            const a=worldToLocal(ship,from),b=worldToLocal(ship,to),dx=b.x-a.x,dy=b.y-a.y;
            let enter=0,leave=1;
            for(const p of polygonPlanes(profile.hull)){
                const origin=a.x*p.x+a.y*p.y,step=dx*p.x+dy*p.y,padding=width*Math.hypot(p.x,p.y);
                if(Math.abs(step)<1e-9){if(origin<p.min-padding || origin>p.max+padding)return undefined;continue;}
                const lo=(p.min-padding-origin)/step,hi=(p.max+padding-origin)/step;
                enter=Math.max(enter,Math.min(lo,hi));leave=Math.min(leave,Math.max(lo,hi));
                if(enter>leave+1e-7)return undefined;
            }
            return enter*Math.hypot(dx,dy);
        }
    }
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0)
        return undefined;
    const along = ((target.x - from.x) * dx + (target.y - from.y) * dy) / length;
    const side = Math.abs((target.x - from.x) * dy - (target.y - from.y) * dx) / length;
    const body = target.radius ?? 0;
    return along >= -body && along <= length + body && side <= width + body ? along : undefined;
}
export function inWeaponCone(from: WeaponPoint, toward: WeaponPoint, target: WeaponPoint, range: number, angle: number) {
    const dx = toward.x - from.x, dy = toward.y - from.y;
    const tx = target.x - from.x, ty = target.y - from.y;
    const aim = Math.hypot(dx, dy), gap = Math.hypot(tx, ty);
    return aim > 0 && gap <= range + (target.radius ?? 0) && (gap === 0 || (tx * dx + ty * dy) / (gap * aim) >= Math.cos(angle / 2));
}
export function weaponDamage(weapon: WeaponDef, damage: number, building: boolean, naval: boolean, share = 1) {
    return Math.max(1, Math.round(damage * (building ? weapon.buildingMultiplier ?? 1 : naval ? weapon.navalMultiplier ?? 1 : 1) * share));
}
