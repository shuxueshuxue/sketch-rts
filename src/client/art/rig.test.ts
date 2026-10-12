import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { UNIT_CARDS } from '../content/units';
import { figures } from './appearance';
import { paintFigure, hasPaintedUnit } from './painted-units';
import { sampleFigurePose, socketPoint, equipmentForKind, type FigurePresentation } from './rig';
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
describe('authored projected poses',()=>{
 it('prepares a directed thrust with visible travel, without sweeping the spear back across other planes',()=>{
  for(const kind of ['lancer','knight'] as const)for(const aim of [-4,0,4])for(let variant=0;variant<3;variant++){
   const ready=sampleFigurePose(figures[kind]!,{mode:'idle',frame:0,carry:6,carryAim:aim});
   const contact=sampleFigurePose(figures[kind]!,{mode:'attack',frame:0,aim,variant});
   const axis=aim*Math.PI/12;
   const along=(contact.wrist[0]-ready.wrist[0])*Math.cos(axis)+(contact.wrist[1]-ready.wrist[1])*Math.sin(axis);
   expect(along).toBeGreaterThan(7);
   expect(distance(contact.wrist,ready.wrist)).toBeLessThan(20);
   for(let frame=1;frame<6;frame++){
    const recovery=sampleFigurePose(figures[kind]!,{mode:'attack',frame,aim,variant,carry:6,carryAim:aim});
    expect(Math.abs(recovery.angle+recovery.lean-axis)).toBeLessThan(.06);
   }
   const recoil=sampleFigurePose(figures[kind]!,{mode:'attack',frame:3,aim,variant,carry:6,carryAim:aim});
   expect((recoil.wrist[0]-ready.wrist[0])*Math.cos(axis)+(recoil.wrist[1]-ready.wrist[1])*Math.sin(axis)).toBeLessThan(-.5);
  }
 });
 it('retains a blade arc from directed preparation, and never shifts the actual contact pose',()=>{
  for(const weapon of ['sword','greatSword','axe','pike','bow','staff','crozier','javelin'] as const)for(const aim of [-4,0,4])for(let variant=0;variant<3;variant++){
   const pose={mode:'attack',frame:0,aim,variant} as const;
   const contact=sampleFigurePose(figures.footman!,pose,{weapon});
   const carried=sampleFigurePose(figures.footman!,{...pose,carry:6,carryAim:aim},{weapon});
   expect(carried.wrist).toEqual(contact.wrist);expect(carried.angle).toBe(contact.angle);
   expect(carried.support).toEqual(contact.support);expect(carried.supportElbow).toEqual(contact.supportElbow);
   if(weapon==='sword'||weapon==='greatSword'||weapon==='axe'){
    const ready=sampleFigurePose(figures.footman!,{mode:'idle',frame:0,carry:6,carryAim:aim},{weapon});
    expect(Math.abs(contact.angle-ready.angle)).toBeGreaterThan(.3);
    expect(Math.abs(contact.angle-ready.angle)).toBeLessThan(1.8);
   }
  }
 });
 it('keeps a thrust on its target plane during contact and initial retraction for every variant',()=>{
  for(const kind of ['lancer','knight'] as const)for(const aim of [-4,0,4])for(let variant=0;variant<3;variant++){
   const expected=aim===0?-.04:aim*Math.PI/12;
   for(const frame of [0,1]){
    const pose=sampleFigurePose(figures[kind]!,{mode:'attack',frame,aim,variant});
    expect(pose.angle+pose.lean).toBeCloseTo(expected,8);
   }
  }
 });
 it('sends the upward spear grip forward and carries the downward grip below the shoulder',()=>{
  for(const kind of ['lancer','knight'] as const)for(let variant=0;variant<3;variant++){
   const ready=sampleFigurePose(figures[kind]!,{mode:'idle',frame:0});
   const up=sampleFigurePose(figures[kind]!,{mode:'attack',frame:0,aim:-4,variant});
   const down=sampleFigurePose(figures[kind]!,{mode:'attack',frame:0,aim:4,variant});
   expect(up.wrist[0]-ready.wrist[0]).toBeGreaterThan(7);
   expect(down.wrist[1]).toBeGreaterThan(down.shoulder[1]);
   expect(down.elbow[1]).toBeGreaterThan(down.shoulder[1]);
  }
 });
 it('keeps authored rear arms behind the torso while held weapons remain visible',()=>{
  for(const weapon of ['sword','axe','staff','crozier'] as const){
   const rig=sampleFigurePose(figures.footman!,{mode:'idle',frame:0},{weapon});
   expect(rig.primaryLayer).toBe('back');expect(rig.equipmentLayer).toBe('front');
   expect(rig.elbow[1]).toBeGreaterThan(rig.shoulder[1]);
  }
 });
 it('allows projected limb shortening and retains upright staff gestures',()=>{
  const idle=sampleFigurePose(figures.footman!,{mode:'idle',frame:0});
  const contact=sampleFigurePose(figures.footman!,{mode:'attack',frame:0});
  expect(distance(idle.elbow,idle.wrist)).toBeLessThan(distance(contact.elbow,contact.wrist));
  for(const mode of ['attack','cast'] as const)for(const aim of [-6,0,6]){
   const staff=sampleFigurePose(figures.summoner!,{mode,frame:0,aim});
   expect(Math.abs(staff.angle)).toBeLessThan(.25);
   expect(staff.support).not.toEqual(sampleFigurePose(figures.summoner!,{mode:'idle',frame:0}).support);
  }
 });
 it('keeps authored coordinates finite and both grips attached when supporting the handle',()=>{
  for(const weapon of weapons)for(const mode of ['idle','walk','attack','cast','work'] as const)for(let frame=0;frame<(mode==='idle'||mode==='walk'?8:6);frame++)for(let variant=0;variant<3;variant++){
   const rig=sampleFigurePose(figures.footman!,{mode,frame,variant},{weapon});
   expect([...rig.wrist,...rig.elbow,...rig.support,...rig.supportElbow].every(Number.isFinite)).toBe(true);
   if(rig.twoHanded){
    if(weapon==='greatSword'||weapon==='pick')expect(rig.support).toEqual(socketPoint(rig.wrist,rig.angle,0,weapon==='greatSword'?5:-4));
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
  expect(sampleFigurePose(figures.footman!,pose).motion).toBe(sampleFigurePose(figures.mercenary!,pose).motion);
  expect(raster('footman',pose,{motion:'slash'})).not.toEqual(raster('footman',pose,{motion:'thrust'}));
  expect(raster('footman',pose,{weapon:'sword'})).not.toEqual(raster('footman',pose,{weapon:'axe'}));
 });
 it('resolves compatible nonhuman issued loadouts and shows an equipped round shield',()=>{
  expect(equipmentForKind('murlocHunter')).toBe('javelin');
  expect(equipmentForKind('ogreMage')).toBe('staff');
  expect(equipmentForKind('ogreWarrior')).toBe('club');
  expect(equipmentForKind('thornSlinger')).toBe('sling');
  expect(raster('footman',{mode:'idle',frame:0},{shield:true,shieldStyle:'round'})).not.toEqual(raster('footman',{mode:'idle',frame:0}));
  expect(sampleFigurePose(figures.footman!,{mode:'idle',frame:0},{weapon:'greatSword',shield:true}).shield).toBe(false);
 });
 it('keys every presentation choice including stable detail callbacks',()=>{
  const detail=()=>{};
  expect(appearanceKey({detail})).toBe(appearanceKey({detail}));
  const variants:FigurePresentation[]=[{}, {weapon:'axe'},{cloth:'#123456'},{headwear:false},{shield:false},{motion:'thrust'},{appearance:{armor:false}},{appearance:{elite:true}},{appearance:{role:'mage'}},{detail},{detail:()=>{}}];
  expect(new Set(variants.map(appearanceKey)).size).toBe(variants.length);
 });
});
