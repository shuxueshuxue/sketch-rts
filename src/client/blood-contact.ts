/** Bounded swept-droplet contacts. World height is physical; stains retain the
 * receiver's local coordinates. No combat hitboxes or simulation writes. */
import type {Unit} from '../shared/types';
import {figures} from './art/appearance';
import {unitGlyphScale} from './glyphs';
import {isInCabin} from '../shared/ship-cabin';
import {shipProfile} from '../shared/ship-geometry';
import {BLOOD_HEIGHT_PROJECTION as TILT,type BloodSurface,type BloodSurfaceResolver} from './combat-surfaces';
export type BloodPoint={x:number;y:number;z:number};
export type BloodContact={unit:Unit;surface:BloodSurface;point:BloodPoint;distance:number;weapon?:{key:string;segment:number;t:number;width:number}};
const CELL=96;
type Shape={a:BloodPoint;b:BloodPoint;width:number;weapon?:NonNullable<BloodContact['weapon']>};
type Receiver={unit:Unit;surface?:BloodSurface;shapes?:Shape[]};
export class BloodContacts {
 private grid=new Map<string,Receiver[]>();
 constructor(units:Iterable<Unit>,private resolve:BloodSurfaceResolver|undefined,private now:number){
  for(const unit of units){
   if(unit.hp<=0||unit.kind==='spirit'||shipProfile(unit)||isInCabin(unit))continue;
   const key=`${Math.floor(unit.x/CELL)}:${Math.floor(unit.y/CELL)}`,cell=this.grid.get(key)??[];
   cell.push({unit});this.grid.set(key,cell);
  }
 }
 private prepare(receiver:Receiver){
  const unit=receiver.unit,surface=receiver.surface=this.resolve?.(unit,this.now)??{facing:1,floor:0};
  const shapes:Shape[]=[],figure=figures[unit.kind],scale=surface.bodyScale??unitGlyphScale(unit.radius);
  const add=(a:BloodPoint,b:BloodPoint,width:number,weapon?:NonNullable<BloodContact['weapon']>)=>shapes.push({a,b,width,...(weapon?{weapon}:{})});
  if(figure){
   const lift=figure.mounted?17:0;
   const body=(x:number,z:number):BloodPoint=>({x:unit.x+x*scale*surface.facing,y:unit.y,z:surface.floor+(z+lift)*scale/TILT});
   add(body(0,31),body(0,38),4.8*scale);add(body(1,51),body(1,53),3.2*scale);
   if(!figure.mounted)for(const side of [-1,1])add(body(side*4,4),body(side*4,22),2.2*scale);
  }else{
   const width=Math.max(3,Math.min(14,unit.radius*.34));
   add({x:unit.x,y:unit.y,z:surface.floor+unit.radius*1.75},{x:unit.x,y:unit.y,z:surface.floor+unit.radius*2.4},width);
  }
  surface.weapon?.segments.forEach((segment,index)=>{
   const point=(p:readonly[number,number]):BloodPoint=>({x:unit.x+p[0]*surface.facing,y:unit.y,z:surface.floor-p[1]/TILT});
   add(point(segment.a),point(segment.b),segment.width,{key:surface.weapon!.key,segment:index,t:0,width:segment.width});
  });
  receiver.shapes=shapes;
 }
 contact(a:BloodPoint,b:BloodPoint,radius:number,exclude:string,ignored:ReadonlySet<string>):BloodContact|undefined{
  let result:BloodContact|undefined;
  // Equipment extends beyond body radius. Y is depth, so reject out-of-plane
  // receivers before preparing their authored surfaces. Cache each receiver's
  // capsules once per snapshot, not once for every droplet.
  const minX=Math.floor(Math.min(a.x,b.x)/CELL)-2,maxX=Math.floor(Math.max(a.x,b.x)/CELL)+2;
  const minY=Math.floor(Math.min(a.y,b.y)/CELL)-1,maxY=Math.floor(Math.max(a.y,b.y)/CELL)+1;
  for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)for(const receiver of this.grid.get(`${x}:${y}`)??[]){
   const unit=receiver.unit;if(unit.id===exclude)continue;
   if(Math.abs(unit.y-(a.y+b.y)/2)>Math.abs(b.y-a.y)/2+Math.min(14,unit.radius*.34)+radius)continue;
   if(!receiver.shapes)this.prepare(receiver);
   const bodyIgnored=ignored.has(`${unit.id}:body`),weaponIgnored=ignored.has(`${unit.id}:weapon`);
   for(const shape of receiver.shapes!){
    if(shape.weapon?weaponIgnored:bodyIgnored)continue;
    const width=radius+shape.width,c=shape.a,d=shape.b;
    if(Math.max(a.x,b.x)<Math.min(c.x,d.x)-width||Math.min(a.x,b.x)>Math.max(c.x,d.x)+width||Math.max(a.z,b.z)<Math.min(c.z,d.z)-width||Math.min(a.z,b.z)>Math.max(c.z,d.z)+width)continue;
    closestSegments(a,b,c,d);
    if(closest.distance2>width*width||result&&closest.s>=result.distance)continue;
    result={unit,surface:receiver.surface!,point:{x:a.x+(b.x-a.x)*closest.s,y:a.y+(b.y-a.y)*closest.s,z:a.z+(b.z-a.z)*closest.s},distance:closest.s,...(shape.weapon?{weapon:{...shape.weapon,t:closest.t}}:{})};
   }
  }
  return result;
 }
}
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
// Synchronous scratch avoids vectors/closures for every rejected candidate.
const closest={s:0,t:0,distance2:0};
function closestSegments(p:BloodPoint,q:BloodPoint,a:BloodPoint,b:BloodPoint){
 const ux=q.x-p.x,uy=q.y-p.y,uz=q.z-p.z,vx=b.x-a.x,vy=b.y-a.y,vz=b.z-a.z,rx=p.x-a.x,ry=p.y-a.y,rz=p.z-a.z;
 const aa=ux*ux+uy*uy+uz*uz,ee=vx*vx+vy*vy+vz*vz,f=vx*rx+vy*ry+vz*rz;let s=0,t=0;
 if(aa<=1e-9)t=ee>1e-9?clamp(f/ee):0;
 else{const c=ux*rx+uy*ry+uz*rz;if(ee<=1e-9)s=clamp(-c/aa);else{const bb=ux*vx+uy*vy+uz*vz,denom=aa*ee-bb*bb;s=denom>1e-9?clamp((bb*f-c*ee)/denom):0;t=(bb*s+f)/ee;if(t<0){t=0;s=clamp(-c/aa);}else if(t>1){t=1;s=clamp((bb-c)/aa);}}}
 const dx=rx+ux*s-vx*t,dy=ry+uy*s-vy*t,dz=rz+uz*s-vz*t;
 closest.s=s;closest.t=t;closest.distance2=dx*dx+dy*dy+dz*dz;
}
