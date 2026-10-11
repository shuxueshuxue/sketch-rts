/** Small world-space ink accents; no unit texture variants or simulation writes. */
import { SHIP_CAMERA } from '../../shared/ship-geometry';
import type { CombatPresentationFrame } from '../combat-presentation';

type Point={x:number;y:number};
type Brush=CanvasRenderingContext2D;
type Projection={worldToScreen:(point:Point)=>Point;nearScreen:(point:Point,pad:number)=>boolean};
const HEIGHT=Math.tan(SHIP_CAMERA.tilt);

export function drawCombatGround(ctx:Brush,frame:CombatPresentationFrame,projection:Projection,elevated=false){
  ctx.save();
  for(const stain of frame.ground){
    if((stain.height>0)!==elevated)continue;
    const point=projection.worldToScreen({x:stain.x,y:stain.y-stain.height*HEIGHT});
    if(!projection.nearScreen(point,stain.radius*3))continue;
    ctx.globalAlpha=stain.alpha*.72;ctx.fillStyle='#713a32';
    ctx.beginPath();ctx.ellipse(point.x,point.y,stain.radius,stain.radius*.48,stain.angle,0,Math.PI*2);ctx.fill();
    // Uneven dry edge gives a little torn-paper texture without a large decal.
    ctx.globalAlpha=stain.alpha*.32;ctx.fillStyle='#9d5140';
    ctx.beginPath();ctx.ellipse(point.x+stain.radius*.52,point.y-stain.radius*.12,stain.radius*.37,stain.radius*.23,stain.angle+.7,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}

/** Called beside the unit painter, so marks follow its actual deck/bridge anchor. */
export function drawCombatBody(ctx:Brush,marks:CombatPresentationFrame['body'],point:Point,facing:1|-1){
  if(!marks.length)return;
  ctx.save();ctx.fillStyle='#883e34';
  for(const mark of marks){
    ctx.globalAlpha=mark.alpha*.77;
    const x=point.x+facing*mark.localX,y=point.y+mark.localY;
    ctx.beginPath();ctx.ellipse(x,y,mark.radius*.65,mark.radius,mark.angle*facing,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=mark.alpha*.36;ctx.fillStyle='#542f2b';
    ctx.beginPath();ctx.ellipse(x,y+mark.radius*.7,mark.radius*.25,mark.radius*.62,mark.angle*facing,0,Math.PI*2);ctx.fill();ctx.fillStyle='#883e34';
  }
  ctx.restore();
}

export function drawCombatAir(ctx:Brush,frame:CombatPresentationFrame,projection:Projection,
  anchor?:(unitId:string,height:number,position:Point)=>Point|null|undefined,reducedMotion=false){
  ctx.save();ctx.lineCap='round';
  if(!reducedMotion)for(const line of frame.speedLines){
    const attached=anchor?.(line.unitId,line.height,line);
    if(attached===null)continue;
    const point=attached??projection.worldToScreen({x:line.x,y:line.y-line.height*HEIGHT});
    if(!projection.nearScreen(point,line.length+24))continue;
    // Project the actual travel vector: diagonal/upward charges never get a horizontal decal.
    const origin=projection.worldToScreen({x:0,y:0}),tip=projection.worldToScreen({x:line.dx,y:line.dy});
    const d=Math.hypot(tip.x-origin.x,tip.y-origin.y)||1,dx=(tip.x-origin.x)/d,dy=(tip.y-origin.y)/d;
    const nx=-dy,ny=dx;
    ctx.globalAlpha=line.alpha*.58;ctx.strokeStyle='#514b40';ctx.lineWidth=line.width;
    const back=8,length=line.length;
    ctx.beginPath();ctx.moveTo(point.x-dx*back,point.y-dy*back);
    ctx.quadraticCurveTo(point.x-dx*(back+length*.5)+nx,point.y-dy*(back+length*.5)+ny,point.x-dx*(back+length),point.y-dy*(back+length));ctx.stroke();
  }
  for(const drop of frame.droplets){
    const point=projection.worldToScreen({x:drop.x,y:drop.y-drop.height*HEIGHT});
    if(!projection.nearScreen(point,12))continue;
    const angle=Math.atan2(drop.vy-drop.vz*HEIGHT,drop.vx),speed=Math.hypot(drop.vx,drop.vy-drop.vz*HEIGHT);
    ctx.globalAlpha=drop.alpha*.82;ctx.fillStyle='#9b4436';
    ctx.beginPath();ctx.ellipse(point.x,point.y,drop.radius*(reducedMotion?1:1+Math.min(.85,speed/180)),drop.radius*.7,angle,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
