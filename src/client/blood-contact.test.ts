import {describe,it,expect} from 'vitest';
import {createGame} from '../shared/sim';
import {BloodContacts} from './blood-contact';
import {CombatPresentationTracker,type BodyBlood} from './combat-presentation';
import type {WorldEffect} from '../shared/types';
import type {BloodSurfaceResolver} from './combat-surfaces';
const scene=()=>{const g=createGame('bareDuel',{aiPlayers:[]});g.units=[];return{g,near:g.spawnUnit('player','footman',122,100),far:g.spawnUnit('enemy','footman',400,100)};};
const hit:WorldEffect={id:'spray',type:'hit',x:100,y:100,duration:14,remaining:14,unitId:'victim',damage:100,targetKind:'footman',targetHpAfter:0,targetMaxHp:180,targetRadius:18,targetUnitClass:'nonMechanical',fromX:50,fromY:100};
describe('blood surface transfer',()=>{
 it('sweeps real flight paths into nearby bodies, excluding depth-separated or distant people',()=>{
  const {g,near,far}=scene(),contacts=new BloodContacts(g.units,undefined,0);
  const contact=contacts.contact({x:100,y:100,z:34},{x:140,y:100,z:34},1,'victim',new Set());
  expect(contact?.unit.id).toBe(near.id);expect(contact?.weapon).toBeUndefined();
  expect(contacts.contact({x:100,y:130,z:34},{x:140,y:130,z:34},1,'victim',new Set())).toBeUndefined();
  expect(contact?.unit.id).not.toBe(far.id);
 });
 it('attaches a flying drop to a nearby survivor and fades it without marking the distant actor',()=>{
  const {g,near,far}=scene(),tracker=new CombatPresentationTracker();
  tracker.update({tick:0,units:g.units,effects:[hit]},0);
  let mark:BodyBlood|undefined;
  for(let tick=1;tick<=15;tick++){tracker.update({tick,units:g.units,effects:[]},tick*50);mark??=tracker.frame(tick*50).body.find(m=>m.unitId===near.id);}
  expect(mark).toBeDefined();expect(tracker.frame(750).body.some(m=>m.unitId===far.id)).toBe(false);
  const local={x:mark!.localX,y:mark!.localY};near.x+=40;
  tracker.update({tick:16,units:g.units,effects:[]},800);
  expect(tracker.frame(800).body.find(m=>m.unitId===near.id)).toMatchObject({x:near.x,localX:local.x,localY:local.y});
  tracker.update({tick:150,units:g.units,effects:[]},7500);expect(tracker.frame(7500).body).toHaveLength(0);
 });
 it('keeps weapon stains on their contacted segment when it turns, and does not transfer them to replacement equipment',()=>{
  const {g,near}=scene();near.x=70;near.y=100;
  let angle=0,key='blade-a';
  const surface:BloodSurfaceResolver=()=>({facing:1,floor:0,weapon:{key,segments:[{a:[25,-30],b:[45*Math.cos(angle),-30+45*Math.sin(angle)],width:2}]}});
  const tracker=new CombatPresentationTracker();
  for(let tick=0;tick<16;tick++)tracker.update({tick,units:g.units,effects:tick===0?[hit]:[]},tick*50,surface);
  const first=tracker.frame(750).body.find(m=>m.surface==='weapon');expect(first).toBeDefined();
  const xy=[first!.localX,first!.localY];angle=.5;
  tracker.update({tick:16,units:g.units,effects:[]},800,surface);
  const changed=tracker.frame(800).body.find(m=>m.surface==='weapon');expect(changed).toBeDefined();expect([changed!.localX,changed!.localY]).not.toEqual(xy);
  key='blade-b';tracker.update({tick:17,units:g.units,effects:[]},850,surface);
  expect(tracker.frame(850).body.some(m=>m.surface==='weapon')).toBe(false);
  key='blade-a';tracker.update({tick:18,units:g.units,effects:[]},900,surface);
  expect(tracker.frame(900).body.some(m=>m.surface==='weapon')).toBe(false);
 });
 it('has the same attachments regardless of extra interpolated renders and never changes units',()=>{
  const {g}=scene(),a=new CombatPresentationTracker(),b=new CombatPresentationTracker(),before=JSON.stringify(g.units);
  for(let tick=0;tick<20;tick++){
   const snap={tick,units:g.units,effects:tick===0?[hit]:[]};a.update(snap,tick*50);b.update(snap,tick*50);
   for(let frame=0;frame<4;frame++)a.frame(tick*50+frame*10);
   expect(a.frame(tick*50)).toEqual(b.frame(tick*50));
  }
  expect(JSON.stringify(g.units)).toBe(before);
 });
});
