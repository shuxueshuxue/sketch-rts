import type { WeaponDef } from "./catalog";
import { localToWorld, shipProfile, worldToLocal } from "./ship-geometry";
import { polygonPlanes } from "./navigation-math";
import type { Building, Obstacle, Unit } from "./types";
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
    const body = (target.radius ?? 0)+width;
    if(side>body+1e-7)return undefined;
    const halfChord=Math.sqrt(Math.max(0,body*body-side*side));
    const enter=along-halfChord,leave=along+halfChord;
    return leave>=-1e-7 && enter<=length+1e-7 ? Math.max(0,along) : undefined;
}
export function inWeaponCone(from: WeaponPoint, toward: WeaponPoint, target: WeaponPoint, range: number, angle: number) {
    const dx = toward.x - from.x, dy = toward.y - from.y;
    const tx = target.x - from.x, ty = target.y - from.y;
    const aim = Math.hypot(dx, dy), gap = Math.hypot(tx, ty);
    if (aim > 0 && "order" in target && angle > 0 && angle < Math.PI) {
        const ship=target as Unit,profile=shipProfile(ship);
        if(profile){
            // Clip the actual hull to the cone's two angular half-planes,
            // then test its nearest remaining edge against the range circle.
            // A long bow or stern can be in the flame even when its center is not.
            let polygon=profile.hull.map(p=>{const world=localToWorld(ship,p),x=world.x-from.x,y=world.y-from.y;return{x:(x*dx+y*dy)/aim,y:(y*dx-x*dy)/aim};});
            const slope=Math.tan(angle/2);
            for(const side of [-1,1]){
                const clipped:typeof polygon=[];
                for(let i=0;i<polygon.length;i++){
                    const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,da=a.x*slope+side*a.y,db=b.x*slope+side*b.y;
                    if(da>=-1e-7)clipped.push(a);
                    if((da<0)!==(db<0)){const t=da/(da-db);clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
                }
                polygon=clipped;
            }
            return polygon.some((a,i)=>{const b=polygon[(i+1)%polygon.length]!,x=b.x-a.x,y=b.y-a.y,length=x*x+y*y;
                const t=length?Math.max(0,Math.min(1,-(a.x*x+a.y*y)/length)):0;
                return Math.hypot(a.x+x*t,a.y+y*t)<=range+1e-7;});
        }
    }
    return aim > 0 && gap <= range + (target.radius ?? 0) && (gap === 0 || (tx * dx + ty * dy) / (gap * aim) >= Math.cos(angle / 2));
}
export function weaponDamage(weapon: WeaponDef, damage: number, building: boolean, naval: boolean, share = 1) {
    return Math.max(1, Math.round(damage * (building ? weapon.buildingMultiplier ?? 1 : naval ? weapon.navalMultiplier ?? 1 : 1) * share));
}

/** A shot through exposed deck crew damages those crew before their hull. */
export function crewBeforeHulls<T extends Unit | Building | Obstacle>(targets: T[]): T[] {
    const occupied = new Set(targets.flatMap(target => "order" in target && target.deck ? [target.deck.shipId] : []));
    return targets.filter(target => !("order" in target) || !shipProfile(target) || !occupied.has(target.id));
}
