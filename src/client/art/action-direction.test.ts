import { expect,it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { animationKey, finiteAim, projectActionFrame } from './action-direction';
import { creatures, figures } from './appearance';
import { actionDirection } from './motion';
import { sampleFigurePose, socketPoint } from './rig';
import { paintFigure } from './painted-units';
import { ART_ACTION_SIZE } from './raster-cache';
import type { EquipmentKind } from './equipment';
import type { UnitAnimationFrame } from '../unit-animation';
const weapons:EquipmentKind[]=['none','sword','greatSword','axe','club','pike','pitchfork','bow','staff','crozier','pick','javelin','sling'];
it('quantizes continuous targets to thirteen states and shares recovery with ready',()=>{
 const poses=new Set<UnitAnimationFrame>();
 for(let degrees=-90;degrees<=90;degrees+=.5){
  const radians=degrees*Math.PI/180;
  poses.add(projectActionFrame({mode:'attack',frame:0,direction:{x:Math.cos(radians),y:Math.sin(radians)}},1));
 }
 expect(poses.size).toBe(13);
 for(let aim=-6;aim<=6;aim++){
  const direction=actionDirection({mode:'attack',frame:0,aim});
  expect(Math.abs(direction.correction)).toBeLessThanOrEqual(Math.PI/6+1e-8);
  expect(finiteAim({mode:'idle',frame:0,aim})).toBe(0);
  expect(animationKey({mode:'attack',frame:5,aim,variant:2})).toBe(animationKey({mode:'idle',frame:0}));
 }
 expect(projectActionFrame({mode:'cast',frame:0,direction:{x:0,y:-10}},-1).aim).toBe(-6);
 expect(projectActionFrame({mode:'cast',frame:0,direction:{x:0,y:0,height:40}},1).aim).toBe(-6);
 expect(projectActionFrame({mode:'cast',frame:0,direction:{x:0,y:10}},1).aim).toBe(6);
 expect(projectActionFrame({mode:'attack',frame:0,direction:{x:10,y:0}},1,p=>({x:p.y,y:-p.x})).aim).toBe(-6);
});
it('keeps directional drawings finite and supporting hands on equipment sockets',()=>{
 for(const weapon of weapons)for(const mode of ['attack','cast'] as const)for(let aim=-6;aim<=6;aim++)for(let frame=0;frame<6;frame++){
  const rig=sampleFigurePose(figures.footman!,{mode,frame,aim},{weapon});
  expect([...rig.wrist,...rig.elbow,...rig.support,...rig.supportElbow].every(Number.isFinite)).toBe(true);
  if(rig.twoHanded){
   const sx=weapon==='bow'?-3-rig.motion.bowDraw*9:weapon==='greatSword'||weapon==='pick'?0:-9;
   const sy=weapon==='greatSword'?5:weapon==='pick'?-4:0;
   expect(rig.support).toEqual(socketPoint(rig.wrist,rig.angle,sx,sy));
  }
 }
});
it('all weapons fit the full action painting surface at all thirteen directions',()=>{
 const canvas=createCanvas(240,240),b=canvas.getContext('2d');
 for(const weapon of weapons)for(const mode of ['attack','cast'] as const)for(let aim=-6;aim<=6;aim++)for(const frame of [0,2,5]){
  b.resetTransform();b.clearRect(0,0,240,240);b.translate(120,120);
  paintFigure(b as unknown as CanvasRenderingContext2D,'footman','#477b91',{mode,frame,aim},1,{weapon});
  const pixels=b.getImageData(0,0,240,240).data;let escaped=0;
  for(let y=0;y<240;y++)for(let x=0;x<240;x++)if(pixels[(y*240+x)*4+3]&&(Math.abs(x-120)>=ART_ACTION_SIZE/2-1||Math.abs(y-120)>=ART_ACTION_SIZE/2-1))escaped++;
  expect(escaped,`${weapon}/${mode}/${aim}/${frame}`).toBe(0);
 }
});
it('authors different up, level and down silhouettes while every endpoint returns to ready',()=>{
 const canvas=createCanvas(160,160),b=canvas.getContext('2d');
 const raster=(weapon:EquipmentKind,pose:UnitAnimationFrame)=>{b.resetTransform();b.clearRect(0,0,160,160);b.translate(80,80);paintFigure(b as unknown as CanvasRenderingContext2D,'footman','#477b91',pose,1,{weapon});return canvas.toBuffer('image/png').toString('base64');};
 for(const weapon of weapons){
  expect(new Set([-4,0,4].map(aim=>raster(weapon,{mode:'attack',frame:0,aim}))).size,weapon).toBe(3);
  const ready=raster(weapon,{mode:'idle',frame:0});
  for(const aim of [-6,0,6])for(const mode of ['attack','cast'] as const)expect(raster(weapon,{mode,frame:5,aim}),weapon).toBe(ready);
 }
});

it('keeps all native creature and mounted gestures inside the extended domain',()=>{
 const canvas=createCanvas(240,240),b=canvas.getContext('2d');
 const kinds=[...Object.keys(creatures),'knight','horseArcher','raider'] as import('../../shared/types').UnitKind[];
 for(const kind of kinds)for(const mode of ['attack','cast'] as const)for(let aim=-6;aim<=6;aim++){
  b.resetTransform();b.clearRect(0,0,240,240);b.translate(120,120);
  paintFigure(b as unknown as CanvasRenderingContext2D,kind,'#477b91',{mode,frame:0,aim},1);
  const pixels=b.getImageData(0,0,240,240).data;let escaped=0;
  for(let y=0;y<240;y++)for(let x=0;x<240;x++)if(pixels[(y*240+x)*4+3]&&(Math.abs(x-120)>=ART_ACTION_SIZE/2-1||Math.abs(y-120)>=ART_ACTION_SIZE/2-1))escaped++;
  expect(escaped,`${kind}/${mode}/${aim}`).toBe(0);
 }
});

it('keeps downward long weapons above the foot plane rather than stabbing through terrain',()=>{
 const canvas=createCanvas(200,200),b=canvas.getContext('2d');
 for(const weapon of weapons)for(const mode of ['attack','cast'] as const)for(const aim of [2,3,4,5,6]){
  b.resetTransform();b.clearRect(0,0,200,200);b.translate(100,100);
  paintFigure(b as unknown as CanvasRenderingContext2D,'footman','#477b91',{mode,frame:0,aim},1,{weapon});
  const pixels=b.getImageData(0,120,200,80).data;
  expect(pixels.some((n,i)=>i%4===3&&n>16),`${weapon}/${mode}/${aim}`).toBe(false);
 }
});
