import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { shipProfile } from '../shared/ship-geometry';
import type { GameSnapshot } from '../shared/types';
import type { Terrain } from '../shared/terrain';
import { createScratchCanvas } from './art/scratch-canvas';
import { waterCoverage, waterField } from './water-field';

type Point = { x:number; y:number };
type Trail = Point & { shipId:string; heading:number; beam:number; length:number; speed:number; at:number; seed:number; serial:number };
type Track = Point & { tick:number; emitted:number; serial:number };
const LIFE = 5.4, BOW_LIFE = 1.4, INTERVAL = .16;
const masks = new WeakMap<Terrain, HTMLCanvasElement>();
const patches:HTMLCanvasElement[]=[];
const bows:HTMLCanvasElement[]=[];
function bowPatch(variant:number){
  if(bows[variant])return bows[variant]!;
  const canvas=createScratchCanvas(64,64),b=canvas.getContext('2d')!;
  // Two loose pockets of disturbed water, with no continuous white crest.
  // The uneven grains remain soft when the viewport buffer scales them down.
  for(const side of [-1,1]){
    const wash=b.createRadialGradient(22,32+side*13,0,22,32+side*13,16);
    wash.addColorStop(0,'#b5d7c82e');wash.addColorStop(1,'#b5d7c800');
    b.fillStyle=wash;b.fillRect(0,0,64,64);
    for(let i=0;i<25;i++){
      const t=((i*13+variant*7+(side+1)*5)%29)/29;
      const jitter=Math.sin(i*9.7+variant*3.1+side*2.3);
      const x=6+t*51,y=32+side*(18*(1-t)**.75+2)+jitter*6;
      b.beginPath();b.ellipse(x,y,1.1+(i%4)*.35,.65+(i%3)*.2,jitter*.7,0,Math.PI*2);
      b.fillStyle=i%3===0?'#dce9d979':'#bddece47';b.fill();
    }
  }
  bows[variant]=canvas;return canvas;
}
/** Small reusable foam/ripple stamps. No gradients or pixel synthesis in the
 * frame loop, even in the software renderer. Broken crests avoid hairline trails. */
function wakePatch(variant:number){
  if(patches[variant])return patches[variant]!;
  const canvas=createScratchCanvas(96,96),b=canvas.getContext('2d')!;
  const wash=b.createRadialGradient(48,48,0,48,48,37);
  wash.addColorStop(0,'#a0d1c375');wash.addColorStop(1,'#a0d1c300');
  b.fillStyle=wash;b.fillRect(0,0,96,96);
  for(const side of [-1,1]){
    const y=48+side*(29+variant*2);
    b.beginPath();b.moveTo(24,y);b.quadraticCurveTo(43+variant*3,y+side*2,72,y-side*13);
    b.lineWidth=5;b.strokeStyle='#264e5828';b.stroke();
    b.lineWidth=2.5;b.strokeStyle='#dbebdabc';b.stroke();
    for(let i=0;i<5;i++){
      const x=29+i*7,y2=y-side*(i*i*.55)+Math.sin(i*7+variant)*2;
      b.fillStyle='#e2ebd89c';b.fillRect(x,y2,1.5+(i%2),1.3);
    }
  }
  patches[variant]=canvas;return canvas;
}
function coastMask(terrain:Terrain) {
  let mask=masks.get(terrain); if(mask)return mask;
  mask=createScratchCanvas(terrain.cols,terrain.rows);
  const ctx=mask.getContext('2d')!, image=ctx.createImageData(terrain.cols,terrain.rows), field=waterField(terrain);
  for(let i=0;i<field.coverage.length;i++){
    image.data.set([255,255,255,Math.round(waterCoverage(field.coverage[i]!)*255)],i*4);
  }
  ctx.putImageData(image,0,0);masks.set(terrain,mask);return mask;
}

/** Local, presentation-only disturbances. Samples remain in world space after
 * a ship turns or stops; nothing modifies physics or creates a second ocean.
 * Finite-hull divergent crests and stern turbulence are a visual approximation:
 * https://arxiv.org/abs/1304.2653
 * https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models
 * Work/memory are bounded by live ships, five seconds of trails and the view. */
export class ShipWakeTracker {
  private tracks=new Map<string,Track>();
  private trails:Trail[]=[];
  private tick=-1;
  private terrain:Terrain|undefined;
  private surface:HTMLCanvasElement|undefined;

  update(snapshot:Pick<GameSnapshot,'tick'|'units'|'map'>,now:number) {
    if(this.terrain!==snapshot.map.terrain || snapshot.tick<this.tick){this.tracks.clear();this.trails=[];this.tick=-1;this.terrain=snapshot.map.terrain;}
    this.trails=this.trails.filter(sample=>now/1000-sample.at<LIFE);
    if(snapshot.tick===this.tick)return;
    const alive=new Set<string>();
    for(const ship of snapshot.units){
      const profile=shipProfile(ship);if(!profile)continue;
      alive.add(ship.id);
      const old=this.tracks.get(ship.id), elapsed=old?(snapshot.tick-old.tick)/SIM_TICKS_PER_SECOND:0;
      const travel=old?Math.hypot(ship.x-old.x,ship.y-old.y):0;
      // Resyncs/teleports cannot draw a streak through land or across the map.
      const speed=elapsed>0&&elapsed<.6&&travel<100?travel/elapsed:0;
      const emitted=old?.emitted??now/1000;
      if(speed>4 && now/1000-emitted>=INTERVAL){
        let seed=0;for(const ch of ship.id)seed=(seed*31+ch.charCodeAt(0))>>>0;
        this.trails.push({shipId:ship.id,x:ship.x,y:ship.y,heading:ship.sailing?.heading??0,beam:profile.beam,length:profile.length,speed,at:now/1000,seed,serial:old?.serial??0});
      }
      const emits=speed>4&&now/1000-emitted>=INTERVAL;
      this.tracks.set(ship.id,{x:ship.x,y:ship.y,tick:snapshot.tick,emitted:emits?now/1000:emitted,serial:(old?.serial??0)+Number(emits)});
    }
    for(const id of this.tracks.keys())if(!alive.has(id))this.tracks.delete(id);
    this.tick=snapshot.tick;
  }
  get sampleCount(){return this.trails.length;}

  draw(ctx:CanvasRenderingContext2D,view:Point&{width:number;height:number},now:number) {
    const visible=this.trails.filter(p=>p.x>view.x-350&&p.x<view.x+view.width+350&&p.y>view.y-350&&p.y<view.y+view.height+350);
    if(!visible.length)return;
    // A single viewport-sized reusable buffer gives exact shared coast clipping.
    const scale=Math.min(.5,960/view.width,600/view.height), width=Math.ceil(view.width*scale),height=Math.ceil(view.height*scale);
    const canvas=this.surface??=createScratchCanvas(width,height);
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    const b=canvas.getContext('2d')!;b.setTransform(1,0,0,1,0,0);b.clearRect(0,0,width,height);b.scale(scale,scale);b.translate(-view.x,-view.y);
    const stride=Math.max(3,Math.ceil(visible.length/320));
    const bowStride=Math.max(1,Math.ceil(visible.filter(sample=>now/1000-sample.at<BOW_LIFE).length/160));
    for(const sample of visible){
      // History is fine-grained for turns, but overlapping foam needs only
      // every third sample. Detail scales with occupied screen area.
      const age=now/1000-sample.at, fade=(1-age/LIFE)**2, power=Math.min(1,sample.speed/95);
      const stern=sample.serial%stride===0;
      // Keep the newest disturbance visible even in a large fleet. Thinning
      // the short bow history like the stern would put it behind a moving hull.
      const bow=age<BOW_LIFE&&(sample.serial%bowStride===0||sample.serial===(this.tracks.get(sample.shipId)?.serial??0)-1);
      if(!stern&&!bow)continue;
      b.save();b.translate(sample.x,sample.y);b.rotate(sample.heading);
      if(stern){
        const spread=age*(12+sample.speed*.12), aft=-sample.length*.4-age*7;
        const w=sample.beam*.8+spread*.4,h=sample.beam+spread*2;
        b.globalAlpha=fade*power*.36;
        b.drawImage(wakePatch((sample.seed+sample.serial)%3),aft-w/2,-h/2,w,h);
      }
      // Bow disturbances use the same world-space history as the stern wake.
      // Stopping only ends emission; existing foam spreads and fades in seconds.
      if(bow){
        const bowWidth=sample.length*.2+age*7,bowHeight=sample.beam*(.72+age*.4);
        b.globalAlpha=(1-age/BOW_LIFE)**2*power*.6;
        b.drawImage(bowPatch((sample.seed+sample.serial)%3),sample.length*.4-age*5,-bowHeight/2,bowWidth,bowHeight);
      }
      b.restore();
    }
    if(this.terrain){
      b.globalCompositeOperation='destination-in';
      b.drawImage(coastMask(this.terrain),0,0,this.terrain.cols*this.terrain.cell,this.terrain.rows*this.terrain.cell);
      b.globalCompositeOperation='source-over';
    }
    b.setTransform(1,0,0,1,0,0);ctx.drawImage(canvas,0,0,width,height,0,0,view.width,view.height);
  }
}
