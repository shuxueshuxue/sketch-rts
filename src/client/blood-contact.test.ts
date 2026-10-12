import {describe,it,expect} from 'vitest';
import {createGame} from '../shared/sim';
import {BloodContacts,bloodReceiverBounds,type BloodReceiverBounds} from './blood-contact';
import {CombatPresentationTracker,type BodyBlood,type BloodReceiverQuery} from './combat-presentation';
import type {WorldEffect} from '../shared/types';
import type {BloodSurfaceResolver} from './combat-surfaces';
import {localToWorld,shipProfile} from '../shared/ship-geometry';
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
 it('includes whole equipment-receiver cells rather than only centers near the swept segment',()=>{
  const {g,near,far}=scene();near.x=-191;near.y=0;far.x=287;far.y=0;
  const surface:BloodSurfaceResolver=unit=>({facing:1,floor:0,weapon:{key:unit.id,segments:[{a:[-unit.x,0],b:[10-unit.x,0],width:2}]}});
  const bounds=bloodReceiverBounds(0,0,1,0);
  expect(bounds).toEqual({left:-192,top:-96,right:288,bottom:192});
  const receivers=g.units.filter(unit=>unit.x>=bounds.left&&unit.x<=bounds.right&&unit.y>=bounds.top&&unit.y<=bounds.bottom);
  const full=new BloodContacts(g.units,surface,0),subset=new BloodContacts(receivers,surface,0),a={x:0,y:0,z:0},b={x:1,y:0,z:0};
  const expected=full.contact(a,b,1,'victim',new Set());expect(expected?.weapon).toBeDefined();expect(expected?.unit.id).toBe(near.id);
  expect(subset.contact(a,b,1,'victim',new Set())).toEqual(expected);
 });
 it('keeps every blood record identical when the optional query returns the full snapshot',()=>{
  const {g,near}=scene();near.x=70;near.y=100;
  const body=g.spawnUnit('enemy','footman',122,100);g.spawnUnit('enemy','footman',122,100);
  let angle=0,key='blade-a';
  const surface:BloodSurfaceResolver=unit=>({facing:1,floor:0,...(unit===near?{weapon:{key,segments:[{a:[25,-30] as [number,number],b:[45*Math.cos(angle),-30+45*Math.sin(angle)] as [number,number],width:2}]}}:{})});
  const baseline=new CombatPresentationTracker(),queried=new CombatPresentationTracker(),seen:BloodReceiverBounds[]=[];
  const query:BloodReceiverQuery=bounds=>{seen.push(...bounds);return g.units;};
  let weapon=false,attached=false,ground=false;
  for(const tick of [0,1,4,9,15,16,17,20,40,80,121,181]){
   if(tick===16){angle=.5;body.x+=30;}if(tick===17)key='blade-b';
   const snap={tick,units:g.units,effects:tick===0?[hit]:[]};
   baseline.update(snap,tick*50,surface);queried.update(snap,tick*50,surface,query);
   const expected=JSON.parse(JSON.stringify(baseline.frame(tick*50)));
   expect(queried.frame(tick*50)).toEqual(expected);
   weapon||=expected.body.some((mark:BodyBlood)=>mark.surface==='weapon');attached||=expected.body.some((mark:BodyBlood)=>mark.unitId===body.id);ground||=expected.ground.length>0;
  }
  expect(seen.length).toBeGreaterThan(0);expect(weapon).toBe(true);expect(attached).toBe(true);expect(ground).toBe(true);
 });
 it('queries full world trajectories and preserves contacts and history far outside the camera',()=>{
  const {g,near,far}=scene();for(const unit of g.units){unit.x+=5000;unit.y+=6000;}
  const baseline=new CombatPresentationTracker(),queried=new CombatPresentationTracker(),seen:BloodReceiverBounds[]=[];
  const query:BloodReceiverQuery=bounds=>{seen.push(...bounds);return g.units.filter(unit=>bounds.some(area=>unit.x>=area.left&&unit.x<=area.right&&unit.y>=area.top&&unit.y<=area.bottom));};
  const effects=[{...hit,x:5100,y:6100,fromX:5050,fromY:6100}];
  const before=JSON.stringify(g.units);let attached=false;
  for(const tick of [0,4,10,15,40,80,121,181]){
   const snap={tick,units:g.units,effects:tick===0?effects:[]};baseline.update(snap,tick*50);queried.update(snap,tick*50,undefined,query);
   expect(queried.frame(tick*50)).toEqual(baseline.frame(tick*50));
   attached||=queried.frame(tick*50).body.some(mark=>mark.unitId===near.id);
   expect(queried.frame(tick*50).body.some(mark=>mark.unitId===far.id)).toBe(false);
  }
  expect(attached).toBe(true);expect(seen.every(bounds=>bounds.left>4500&&bounds.top>5500)).toBe(true);expect(JSON.stringify(g.units)).toBe(before);
 });
 it('covers rotated and translated deck trajectories across skipped ticks with identical residue and attachments',()=>{
  const {g,near}=scene(),ship=g.spawnUnit('enemy','transport',5000,6000);
  ship.x=5000;ship.y=6000;
  ship.sailing!.heading=Math.PI/2;near.deck={shipId:ship.id,x:10,y:0};Object.assign(near,localToWorld(ship,near.deck));
  const surface:BloodSurfaceResolver=unit=>({facing:1,floor:unit.deck?shipProfile(ship)!.deckHeight:0,weapon:{key:unit.id,segments:[{a:[-50,-30],b:[50,-30],width:2}]}});
  const baseline=new CombatPresentationTracker(),queried=new CombatPresentationTracker(),seen:BloodReceiverBounds[]=[];
  const query:BloodReceiverQuery=bounds=>{seen.push(...bounds);return g.units.filter(unit=>bounds.some(area=>unit.x>=area.left&&unit.x<=area.right&&unit.y>=area.top&&unit.y<=area.bottom));};
  const effect={...hit,x:ship.x,y:ship.y,fromX:ship.x,fromY:ship.y-50,targetDeck:{shipId:ship.id,x:0,y:0,heading:Math.PI/2},toHeight:shipProfile(ship)!.deckHeight+18};
  const low={...effect,id:'low-deck-spray',damage:5,targetRadius:6,targetDeck:{...effect.targetDeck,x:-15}};
  let residue=false,weapon=false;
  for(const tick of [0,3,10,15,40,41,80,121,181]){
   if(tick===3){ship.x+=150;ship.y-=80;ship.sailing!.heading=.7;Object.assign(near,localToWorld(ship,near.deck));}
   if(tick===41){ship.x+=90;ship.y+=45;ship.sailing!.heading=-.2;Object.assign(near,localToWorld(ship,near.deck));}
   const snap={tick,units:g.units,effects:tick===0?[effect,low]:[]};baseline.update(snap,tick*50,surface);queried.update(snap,tick*50,surface,query);
   const expected=baseline.frame(tick*50),actual=queried.frame(tick*50);expect(actual).toEqual(expected);
   residue||=actual.ground.some(mark=>mark.height===shipProfile(ship)!.deckHeight);weapon||=actual.body.some(mark=>mark.surface==='weapon');
  }
  expect(seen.every(bounds=>bounds.left>4500&&bounds.top>5500),'world-space query').toBe(true);
  expect(residue,'landed deck residue').toBe(true);expect(weapon,'deck weapon transfer').toBe(true);
 });
 it('shares the same prepared receiver surfaces for 48 simultaneous overlapping bursts',()=>{
  const {g,near}=scene();near.x=70;near.y=100;g.spawnUnit('enemy','footman',122,100);
  const fullReads={count:0},indexedReads={count:0};
  const surface=(reads:{count:number}):BloodSurfaceResolver=>()=>({facing:1,floor:0,get weapon(){
   reads.count++;return{key:'shared-blade',segments:[{a:[25,-30] as [number,number],b:[45,-30] as [number,number],width:2}]};
  }});
  const baseline=new CombatPresentationTracker(),queried=new CombatPresentationTracker(),fullSurface=surface(fullReads),indexedSurface=surface(indexedReads);
  let queries=0,maxAreas=0;
  const query:BloodReceiverQuery=bounds=>{
   queries++;maxAreas=Math.max(maxAreas,bounds.length);
   return g.units.filter(unit=>bounds.some(area=>unit.x>=area.left&&unit.x<=area.right&&unit.y>=area.top&&unit.y<=area.bottom));
  };
  for(const tick of [0,1,4,9,15,30,40]){
   const before=queries,snap={tick,units:g.units,effects:tick===0?Array.from({length:48},(_,index)=>({...hit,id:'overlap-'+index})):[]};
   baseline.update(snap,tick*50,fullSurface);queried.update(snap,tick*50,indexedSurface,query);
   expect(queried.frame(tick*50)).toEqual(baseline.frame(tick*50));
   expect(queries-before).toBeLessThanOrEqual(1);
   // Getter accesses expose repeated capsule preparation even when the
   // surface resolver's object itself is cached for the snapshot.
   expect(indexedReads.count).toBe(fullReads.count);
  }
  expect(maxAreas).toBe(48);expect(fullReads.count).toBeGreaterThan(0);
 });
 it('does not query receiver candidates for a burst whose deck no longer exists',()=>{
  const {g}=scene(),tracker=new CombatPresentationTracker();let calls=0;
  const query:BloodReceiverQuery=()=>{calls++;return g.units;};
  const effect={...hit,targetDeck:{shipId:'removed-hull',x:0,y:0,heading:0},toHeight:60};
  tracker.update({tick:0,units:g.units,effects:[effect]},0,undefined,query);
  tracker.update({tick:5,units:g.units,effects:[]},250,undefined,query);
  expect(calls).toBe(0);expect(tracker.frame(250)).toEqual({droplets:[],ground:[],body:[],speedLines:[]});
 });
});
