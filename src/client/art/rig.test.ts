import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { UNIT_CARDS } from '../content/units';
import { figures } from './appearance';
import { paintFigure, hasPaintedUnit } from './painted-units';
import { solveFigureRig, solveTwoBone, socketPoint, equipmentForKind, type FigurePresentation } from './rig';
import { appearanceKey } from './unit-appearance';
import type { EquipmentKind } from './equipment';
import type { UnitKind } from '../../shared/types';
import type { UnitAnimationFrame } from '../unit-animation';
const distance=(a:number[],b:number[])=>Math.hypot(a[0]!-b[0]!,a[1]!-b[1]!);
const weapons:EquipmentKind[]=['sling','javelin','club','sword','greatSword','axe','pike','bow','staff','crozier','pick','pitchfork','none'];
const raster=(kind:UnitKind,pose:UnitAnimationFrame,presentation:FigurePresentation={})=>{
 const canvas=createCanvas(180,160),b=canvas.getContext('2d');b.translate(75,95);
 paintFigure(b as unknown as CanvasRenderingContext2D,kind,'#477b91',pose,1,presentation);
 return b.getImageData(0,0,180,160).data;
};
describe('anatomical constraints',()=>{
 it('clamps impossible requests without stretching either segment',()=>{
  for(const target of [[0,0],[100,0],[-100,-100],[3,12]] as [number,number][]){
   const result=solveTwoBone([0,0],target);
   expect(distance([0,0],result.joint)).toBeCloseTo(11,8);
   expect(distance(result.joint,result.end)).toBeCloseTo(10.5,8);
  }
 });
 it('keeps authored hands reachable and equipment support sockets on the rigid handle',()=>{
  for(const weapon of weapons)for(const mode of ['idle','walk','attack','cast','work'] as const)for(let frame=0;frame<(mode==='idle'||mode==='walk'?8:6);frame++)for(let variant=0;variant<3;variant++){
   const rig=solveFigureRig(figures.footman!,{mode,frame,variant},{weapon});
   expect(distance(rig.shoulder,rig.elbow)).toBeCloseTo(11,7);
   expect(distance(rig.elbow,rig.wrist)).toBeCloseTo(10.5,7);
   if(['pike','pitchfork','greatSword','pick','bow'].includes(weapon)){
    expect(distance([-5,-23],rig.support),`${weapon}/${mode}/${frame}`).toBeLessThanOrEqual(21.501);
    if(weapon==='greatSword'||weapon==='pick')expect(rig.support).toEqual(socketPoint(rig.wrist,rig.angle,0,weapon==='greatSword'?5:6));
   }
  }
 });
});
describe('catalog composition',()=>{
 it('covers every catalog asset through the shared composer',()=>{
  for(const kind of Object.keys(UNIT_CARDS) as UnitKind[])expect(hasPaintedUnit(kind),kind).toBe(true);
 });
 it('returns all compatible equipment to exactly the ready raster after attack and casting',()=>{
  for(const weapon of weapons){
   const idle=raster('footman',{mode:'idle',frame:0},{weapon});
   expect(raster('footman',{mode:'attack',frame:5,variant:2},{weapon}),weapon).toEqual(idle);
   expect(raster('footman',{mode:'cast',frame:5},{weapon}),weapon).toEqual(idle);
  }
 });
 it('renders distinct attack variations, independent casting, and idle across weapon families',()=>{
  for(const weapon of ['sword','axe','pike','bow','staff','crozier'] as const){
   const first=raster('footman',{mode:'attack',frame:0,variant:0},{weapon});
   const second=raster('footman',{mode:'attack',frame:0,variant:1},{weapon});
   expect(first,weapon).not.toEqual(second);
   expect(first,weapon).not.toEqual(raster('footman',{mode:'cast',frame:0},{weapon}));
   expect(raster('footman',{mode:'idle',frame:0},{weapon}),weapon).not.toEqual(raster('footman',{mode:'idle',frame:2},{weapon}));
  }
 });
 it('reuses an action across compatible bodies and switches actions without changing identity',()=>{
  const pose={mode:'attack',frame:0,variant:1} as const;
  expect(solveFigureRig(figures.footman!,pose).motion).toBe(solveFigureRig(figures.mercenary!,pose).motion);
  expect(raster('footman',pose,{motion:'slash'})).not.toEqual(raster('footman',pose,{motion:'thrust'}));
  expect(raster('footman',pose,{weapon:'sword'})).not.toEqual(raster('footman',pose,{weapon:'axe'}));
 });
 it('resolves compatible nonhuman issued loadouts and shows an equipped round shield',()=>{
  expect(equipmentForKind('murlocHunter')).toBe('javelin');
  expect(equipmentForKind('ogreMage')).toBe('staff');
  expect(equipmentForKind('ogreWarrior')).toBe('club');
  expect(equipmentForKind('thornSlinger')).toBe('sling');
  expect(raster('footman',{mode:'idle',frame:0},{shield:true})).not.toEqual(raster('footman',{mode:'idle',frame:0}));
  expect(solveFigureRig(figures.footman!,{mode:'idle',frame:0},{weapon:'greatSword',shield:true}).shield).toBe(false);
 });
 it('keys every presentation choice including stable detail callbacks',()=>{
  const detail=()=>{};
  expect(appearanceKey({detail})).toBe(appearanceKey({detail}));
  const variants:FigurePresentation[]=[{}, {weapon:'axe'},{cloth:'#123456'},{headwear:false},{shield:false},{motion:'thrust'},{appearance:{armor:false}},{appearance:{elite:true}},{appearance:{role:'mage'}},{detail},{detail:()=>{}}];
  expect(new Set(variants.map(appearanceKey)).size).toBe(variants.length);
 });
});
