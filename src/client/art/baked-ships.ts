import { SHIP_CAMERA,localToWorld,shipProfile,shipScale } from "../../shared/ship-geometry";
import type { Unit } from "../../shared/types";
import { bakedImage } from "./baked-assets";
import { createScratchCanvas } from "./scratch-canvas";

type Brush=CanvasRenderingContext2D;
type Point={x:number;y:number};
const masks=new Map<string,HTMLCanvasElement>();
const MAX_MASKS=96;
export function shipDirection(ship:Unit) {
  return ((Math.round((ship.sailing?.heading ?? 0)/(Math.PI*2)*SHIP_CAMERA.directions)%SHIP_CAMERA.directions)+SHIP_CAMERA.directions)%SHIP_CAMERA.directions;
}
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
  const upper=bakedImage(`ships/${ship.kind}-upper`),depth=bakedImage(`ships/${ship.kind}-depth`);
  if(!upper || !depth)return;
  const n=SHIP_CAMERA.frameSize,direction=shipDirection(ship),scale=shipScale(ship);
  const heading=direction/SHIP_CAMERA.directions*Math.PI*2;
  const threshold=Math.round((crew.deck!.x*Math.sin(heading)+crew.deck!.y*Math.cos(heading))/scale);
  const key=`${ship.kind}:${direction}:${threshold}`;
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
export function deckVisualHeight(ship:Unit){return (shipProfile(ship)?.deckHeight ?? 0)*Math.tan(SHIP_CAMERA.tilt);}
export function drawShipFlag(ctx:Brush,ship:Unit,at:Point,color:string) {
  const profile=shipProfile(ship);if(!profile)return;
  const mast=profile.obstacles.find(o=>o.type==="mast");if(!mast)return;
  const world=localToWorld(ship,mast),x=at.x+world.x-ship.x,y=at.y+world.y-ship.y-(profile.deckHeight+profile.mastHeight)*Math.tan(SHIP_CAMERA.tilt);
  ctx.save();ctx.fillStyle=color;ctx.strokeStyle="#303536";ctx.lineWidth=.6;
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+10,y+2);ctx.lineTo(x+8,y+8);ctx.lineTo(x,y+6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
