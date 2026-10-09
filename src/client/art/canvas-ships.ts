import {SHIP_CAMERA,localToWorld,shipProfile,shipScale} from '../../shared/ship-geometry';
import {installedWeapons,mountedWeaponPose} from '../../shared/ship-equipment';
import type {Unit,WorldItem} from '../../shared/types';
type Brush=CanvasRenderingContext2D;
type Point={x:number;y:number};
/** Lightweight physical hull fallback. It has no image atlas or asset requests. */
export function drawCanvasShip(ctx:Brush,ship:Unit,at:Point,items:readonly WorldItem[]){
  const profile=shipProfile(ship);if(!profile)return;
  const scale=shipScale(ship),height=deckVisualHeight(ship);
  const project=(p:Point)=>{const world=localToWorld(ship,p);return{x:at.x+world.x-ship.x,y:at.y+world.y-ship.y-height};};
  const polygon=(points:readonly Point[],fill:string)=>{ctx.beginPath();for(const [i,p] of points.entries()){const q=project(p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);}ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.stroke();};
  ctx.save();ctx.strokeStyle='#8b7350';ctx.lineWidth=2;polygon(profile.hull,'#302a20');polygon(profile.deck,'#6b5438');
  for(const [index,obstacle] of profile.obstacles.filter(o=>o.type==='mast').entries()){const p=project(obstacle),mastHeight=ship.kind==='shipOfTheLine'?([118,150,136][index]??150)*scale:profile.mastHeight;ctx.strokeStyle='#3a3024';ctx.lineWidth=3*scale;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x,p.y-mastHeight*Math.tan(SHIP_CAMERA.tilt));ctx.stroke();}
  for(const item of installedWeapons({items},ship)){const weapon=mountedWeaponPose(ship,item);if(!weapon)continue;const p={x:at.x+weapon.pivot.x-ship.x,y:at.y+weapon.pivot.y-ship.y-weapon.pivotHeight*Math.tan(SHIP_CAMERA.tilt)};
    ctx.globalAlpha=item.durability===0?.45:1;ctx.strokeStyle=weapon.art==='fireShip'?'#b68349':'#707c77';ctx.lineWidth=7*scale;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+Math.cos(weapon.heading)*18*scale,p.y+Math.sin(weapon.heading)*18*scale);ctx.stroke();
  }
  ctx.restore();
}
export function deckVisualHeight(ship:Unit){return (shipProfile(ship)?.deckHeight ?? 0)*Math.tan(SHIP_CAMERA.tilt);}
export function drawShipFlag(ctx:Brush,ship:Unit,at:Point,color:string) {
  const profile=shipProfile(ship);if(!profile)return;
  const mast=profile.obstacles.filter(o=>o.type==="mast")[ship.kind==='shipOfTheLine'?1:0];if(!mast)return;
  const world=localToWorld(ship,mast),x=at.x+world.x-ship.x,y=at.y+world.y-ship.y-(profile.deckHeight+profile.mastHeight)*Math.tan(SHIP_CAMERA.tilt);
  ctx.save();ctx.fillStyle=color;ctx.strokeStyle="#303536";ctx.lineWidth=.6;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+10,y+2);ctx.lineTo(x+8,y+8);ctx.lineTo(x,y+6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
