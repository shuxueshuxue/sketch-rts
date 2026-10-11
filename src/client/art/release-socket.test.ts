import { expect,it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { figureReleaseSocket, resolveReleaseSocket } from './release-socket';
import { creatures, figures } from './appearance';
import { sampleFigurePose } from './rig';
import { storyFigure, storyCreature } from './story-rig';
import { paintFigure } from './painted-units';
import { creatureReleaseSocket, paintCreature } from './painted-creatures';

it('transforms the exact authored socket with torso lean, body lift and mounting',()=>{
 for(const kind of ['priest','knight'] as const)for(const aim of [-6,0,6]){
  const pose={mode:'cast' as const,frame:0,aim},rig=sampleFigurePose(figures[kind]!,pose);
  const p=figureReleaseSocket(kind,pose)!;
  const x=rig.release[0]*Math.cos(rig.lean)-(rig.release[1]+4)*Math.sin(rig.lean)+rig.impact*(figures[kind]!.mounted?.65:2);
  const y=rig.release[0]*Math.sin(rig.lean)+(rig.release[1]+4)*Math.cos(rig.lean)-4+rig.motion.lift+rig.motion.breathe+rig.bodyDrop;
  expect(p.x).toBeCloseTo(kind==='knight'?-3+x*.84:x,8);
  expect(p.y).toBeCloseTo(kind==='knight'?-17+y*.84:y,8);
 }
});
it('uses actual story anatomy, weapon and scaling, even when the combat base differs',()=>{
 const pose={mode:'cast' as const,frame:0,aim:-4};
 const paint=storyFigure('priest',{weapon:'staff',appearance:{ember:true}},.85);
 expect(resolveReleaseSocket({kind:'worker',radius:18,pose,model:{paint}})).toEqual(figureReleaseSocket('priest',pose,{weapon:'staff',appearance:{ember:true}},.85));
 const beast=storyCreature('ogreMage',{size:1.12}),local=creatureReleaseSocket('ogreMage',pose,{size:1.12})!;
 const socket=resolveReleaseSocket({kind:'footman',radius:18,pose,model:{paint:beast}})!;
 expect(socket).toEqual({x:local.x,y:local.y+17-local.ground,ground:17});
 expect(resolveReleaseSocket({kind:'catapult',radius:22,pose})).toBeUndefined();
 expect(resolveReleaseSocket({kind:'warship',radius:50,pose})).toBeUndefined();
});
it('puts a staff release on the visible staff glow, including mirrored-source gestures',()=>{
 for(const aim of [-6,-4,0,4,6]){
  const pose={mode:'cast' as const,frame:0,aim},socket=figureReleaseSocket('summoner',pose)!;
  const canvas=createCanvas(200,200),b=canvas.getContext('2d');b.translate(100,100);
  paintFigure(b as unknown as CanvasRenderingContext2D,'summoner','#477b91',pose,1);
  const rgba=b.getImageData(Math.round(socket.x+100)-2,Math.round(socket.y+100)-2,5,5).data;
  expect(rgba.some((value,index)=>index%4===3&&value>0),`${aim}`).toBe(true);
 }
});
it('places the spear tip on the actual authored artwork through directional recovery',()=>{
 const canvas=createCanvas(220,220),b=canvas.getContext('2d');
 for(const kind of ['lancer','knight'] as const)for(const aim of [-6,-4,0,4,6])for(let frame=0;frame<6;frame++){
  const pose={mode:'attack' as const,frame,aim},socket=figureReleaseSocket(kind,pose)!;
  b.resetTransform();b.clearRect(0,0,220,220);b.translate(110,110);
  paintFigure(b as unknown as CanvasRenderingContext2D,kind,'#477b91',pose,1);
  const pixels=b.getImageData(Math.round(socket.x+110)-2,Math.round(socket.y+110)-2,5,5).data;
  expect(pixels.some((value,index)=>index%4===3&&value>0),`${kind}/${aim}/${frame}`).toBe(true);
 }
});
it('keeps native mouth or palm sockets and outer unit scale separate from world position',()=>{
 const pose={mode:'attack' as const,frame:0,aim:4};
 const local=creatureReleaseSocket('murlocHunter',pose)!;
 expect(resolveReleaseSocket({kind:'murlocHunter',radius:18,pose})).toEqual(local);
 const big=resolveReleaseSocket({kind:'murlocHunter',radius:27,pose})!;
 expect(big.x).toBeCloseTo(local.x*1.5);expect(big.y).toBeCloseTo(local.y*1.5);
 expect(big.ground).toBeCloseTo(local.ground*1.5);
});

it('keeps every creature release attached to its painted mouth, fist or held tool',()=>{
 const canvas=createCanvas(240,240),b=canvas.getContext('2d');
 for(const kind of Object.keys(creatures) as import('../../shared/types').UnitKind[])for(const aim of [-6,-4,0,4,6]){
  const pose={mode:'attack' as const,frame:0,aim},socket=creatureReleaseSocket(kind,pose)!;
  b.resetTransform();b.clearRect(0,0,240,240);b.translate(120,120);
  paintCreature(b as unknown as CanvasRenderingContext2D,kind,'#477b91',pose);
  const pixels=b.getImageData(Math.round(socket.x+120)-2,Math.round(socket.y+120)-2,5,5).data;
  expect(pixels.some((value,index)=>index%4===3&&value>0),`${kind}/${aim}`).toBe(true);
 }
});
