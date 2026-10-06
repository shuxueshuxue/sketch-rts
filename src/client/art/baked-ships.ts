import { SHIP_CAMERA,localToWorld,shipProfile,shipScale,shipWeaponPose } from "../../shared/ship-geometry";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import { installedWeapons, mountedWeaponPose } from "../../shared/ship-equipment";
import type { Unit, WorldEffect, WorldItem } from "../../shared/types";
import { bakedImage } from "./baked-assets";
import { createScratchCanvas } from "./scratch-canvas";

type Brush=CanvasRenderingContext2D;
type Point={x:number;y:number};
const masks=new Map<string,HTMLCanvasElement>();
const MAX_MASKS=96;
export function shipDirection(ship:Unit) {
  return directionFrame(ship.sailing?.heading ?? 0);
}
function directionFrame(angle:number){return ((Math.round(angle/(Math.PI*2)*SHIP_CAMERA.directions)%SHIP_CAMERA.directions)+SHIP_CAMERA.directions)%SHIP_CAMERA.directions;}
function frame(ctx:Brush,source:CanvasImageSource,direction:number,at:Point,scale=1) {
  const n=SHIP_CAMERA.frameSize,size=SHIP_CAMERA.worldSize*scale;
  ctx.drawImage(source,direction%8*n,Math.floor(direction/8)*n,n,n,at.x-size/2,at.y-size/2-SHIP_CAMERA.anchorY*scale,size,size);
}
export function drawBakedShip(ctx:Brush,ship:Unit,at:Point,layer:"base"|"upper",scale=shipScale(ship)) {
  const source=bakedImage(`ships/${ship.kind}-${layer}`);
  if(!source)return false;
  frame(ctx,source,shipDirection(ship),at,scale);return true;
}
/** A world-depth bake, rather than a blanket foreground overlay: rear railings
 * stay behind soldiers and front railings/masts cover only pixels in front. */
export function drawShipOcclusion(ctx:Brush,ship:Unit,at:Point,crew:Unit) {
  const direction=shipDirection(ship),scale=shipScale(ship);
  const heading=direction/SHIP_CAMERA.directions*Math.PI*2;
  const threshold=Math.round((crew.deck!.x*Math.sin(heading)+crew.deck!.y*Math.cos(heading))/scale);
  drawDepthMask(ctx,ship.kind,"upper","depth",direction,at,scale,threshold);
}
function drawDepthMask(ctx:Brush,kind:string,layer:string,depthLayer:string,direction:number,at:Point,scale:number,threshold:number) {
  const upper=bakedImage(`ships/${kind}-${layer}`),depth=bakedImage(`ships/${kind}-${depthLayer}`);
  if(!upper || !depth)return;
  const n=SHIP_CAMERA.frameSize,key=`${kind}:${layer}:${direction}:${threshold}`;
  let mask=masks.get(key);
  if(!mask) {
    mask=createScratchCanvas(n,n);const brush=mask.getContext("2d")!;
    brush.drawImage(depth,direction%8*n,Math.floor(direction/8)*n,n,n,0,0,n,n);
    const pixels=brush.getImageData(0,0,n,n),data=pixels.data;
    for(let i=0;i<data.length;i+=4)if((data[i]!/255-.5)*256<threshold)data[i+3]=0;
    brush.putImageData(pixels,0,0);
    brush.globalCompositeOperation="source-in";
    brush.drawImage(upper,direction%8*n,Math.floor(direction/8)*n,n,n,0,0,n,n);
    if(masks.size>=MAX_MASKS)masks.delete(masks.keys().next().value!);
    masks.set(key,mask);
  }
  const size=SHIP_CAMERA.worldSize*scale;
  ctx.drawImage(mask,at.x-size/2,at.y-size/2-SHIP_CAMERA.anchorY*scale,size,size);
}
export function cannonRecoil(effects:readonly WorldEffect[],shipId:string,itemId?:string) {
  const shot=effects.find(effect=>effect.type==="muzzleFlash" && effect.unitId===shipId && (!itemId || effect.itemId===itemId));
  if(!shot)return 0;
  const age=(shot.duration-shot.remaining)/SIM_TICKS_PER_SECOND;
  return 4*Math.max(0,age<.08?age/.08:1-(age-.08)/.38);
}
/** The gun and its carriage recoil. Hulls, sails and crew retain their physical position. */
export function drawShipWeapon(ctx:Brush,ship:Unit,at:Point,effects:readonly WorldEffect[],crew?:Unit,items?:readonly WorldItem[]) {
  const profile=shipProfile(ship);if(!profile)return;
  if(items){for(const item of installedWeapons({items},ship)){const pose=mountedWeaponPose(ship,item);if(pose)drawGun(ctx,ship,at,effects,pose,pose.art,crew,item);}}
  else{const pose=shipWeaponPose(ship);if(profile.weaponPivot && pose)drawGun(ctx,ship,at,effects,pose,ship.kind,crew);}
}
function drawGun(ctx:Brush,ship:Unit,at:Point,effects:readonly WorldEffect[],pose:NonNullable<ReturnType<typeof shipWeaponPose>>,art:string,crew?:Unit,item?:WorldItem){
  const source=bakedImage(`ships/${art}-weapon`);if(!source)return;
  const scale=shipScale(ship),direction=directionFrame(pose.heading),heading=direction/SHIP_CAMERA.directions*Math.PI*2;
  const recoil=art==="fireShip"?0:cannonRecoil(effects,ship.id,item?.id)*scale;
  const pivot={x:at.x+pose.pivot.x-ship.x-Math.cos(heading)*recoil,y:at.y+pose.pivot.y-ship.y-pose.pivotHeight*Math.tan(SHIP_CAMERA.tilt)-Math.sin(heading)*recoil};
  ctx.save();if(item?.durability===0)ctx.globalAlpha*=.45;
  if(crew){
    const hullHeading=shipDirection(ship)/SHIP_CAMERA.directions*Math.PI*2;
    const y=crew.deck!.x*Math.sin(hullHeading)+crew.deck!.y*Math.cos(hullHeading)-(pose.pivot.y-ship.y)+Math.sin(heading)*recoil;
    drawDepthMask(ctx,art,"weapon","weapon-depth",direction,pivot,scale,Math.round(y/scale));
  }else{
    frame(ctx,source,direction,pivot,scale);
    drawDepthMask(ctx,ship.kind,"upper","depth",shipDirection(ship),at,scale,Math.round((pose.pivot.y-ship.y)/scale));
  }
  ctx.restore();
}

export function deckVisualHeight(ship:Unit){return (shipProfile(ship)?.deckHeight ?? 0)*Math.tan(SHIP_CAMERA.tilt);}
export function drawShipFlag(ctx:Brush,ship:Unit,at:Point,color:string) {
  const profile=shipProfile(ship);if(!profile)return;
  const mast=profile.obstacles.find(o=>o.type==="mast");if(!mast)return;
  const world=localToWorld(ship,mast),x=at.x+world.x-ship.x,y=at.y+world.y-ship.y-(profile.deckHeight+profile.mastHeight)*Math.tan(SHIP_CAMERA.tilt);
  ctx.save();ctx.fillStyle=color;ctx.strokeStyle="#303536";ctx.lineWidth=.6;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+10,y+2);ctx.lineTo(x+8,y+8);ctx.lineTo(x,y+6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
