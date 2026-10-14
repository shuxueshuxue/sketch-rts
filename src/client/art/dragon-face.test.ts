import {createCanvas} from '@napi-rs/canvas';
import {expect,it} from 'vitest';
import {paintCreature,creatureReleaseSocket} from './painted-creatures';
import {actionPaintSize} from './action-direction';
import type {UnitAnimationFrame} from '../unit-animation';

for(const kind of ['dragonWhelp','redDragon'] as const)it(`${kind} keeps its visible muzzle on the existing release socket without clipping in either facing`,()=>{
 for(const mode of ['attack','cast'] as const)for(let aim=-6;aim<=6;aim++)for(const facing of [-1,1] as const){
  const pose:UnitAnimationFrame={mode,frame:0,aim},canvas=createCanvas(360,360),ctx=canvas.getContext('2d');
  ctx.translate(180,180);ctx.scale(facing*2,2);paintCreature(ctx as unknown as CanvasRenderingContext2D,kind,'#56717b',pose);
  const socket=creatureReleaseSocket(kind,pose)!,x=Math.round(180+socket.x*facing*2),y=Math.round(180+socket.y*2);
  const mouth=ctx.getImageData(x-2,y-2,5,5).data;
  expect(mouth.some((value,index)=>index%4===3&&value>128),`${kind} ${mode} ${aim} facing ${facing}: detached mouth`).toBe(true);
  const half=actionPaintSize(pose,kind),pixels=ctx.getImageData(0,0,360,360).data;
  let clipped=0;
  for(let py=0;py<360;py++)for(let px=0;px<360;px++)if(pixels[(py*360+px)*4+3]!>16&&(Math.abs(px-180)>half||Math.abs(py-180)>half))clipped++;
  expect(clipped,`${kind} ${mode} ${aim}: outside production atlas`).toBe(0);
 }
});
it('preserves the existing idle mouth coordinates for both dragon sizes',()=>{
 expect(creatureReleaseSocket('redDragon',{mode:'idle',frame:0})).toMatchObject({x:57.33,y:-23.4});
 expect(creatureReleaseSocket('dragonWhelp',{mode:'idle',frame:0})).toMatchObject({x:39.2,y:-16});
});

it('keeps the resting mouth closed instead of painting a permanent dark grin',()=>{
 const darkMouth=(mode:'idle'|'attack')=>{
  const pose:UnitAnimationFrame={mode,frame:0},canvas=createCanvas(520,360),ctx=canvas.getContext('2d');ctx.translate(160,160);ctx.scale(4,4);
  paintCreature(ctx as unknown as CanvasRenderingContext2D,'redDragon','#56717b',pose,{size:1});
  const socket=creatureReleaseSocket('redDragon',pose,{size:1})!;
  const data=ctx.getImageData(Math.round(160+(socket.x-10)*4),Math.round(160+(socket.y+.7)*4),28,10).data;
  let ink=0;for(let i=0;i<data.length;i+=4)if(data[i]!<75&&data[i+1]!<60&&data[i+2]!<55&&data[i+3]!>200)ink++;
  return ink;
 };
 expect(darkMouth('attack')).toBeGreaterThan(darkMouth('idle')+40);
});
