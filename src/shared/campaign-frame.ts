import type { CampaignFrame } from './campaign-session';
import type { Unit } from './types';
export type CampaignDelta = {type:'frameDelta'; tick:number; units:Partial<Unit>[]; positions:[number,number,number][]; removed:string[]; snapshot:Record<string,unknown>;state?:CampaignFrame['state'];paused:boolean};
const equal=(a:unknown,b:unknown)=>a===b||(typeof a==='object'&&typeof b==='object'&&JSON.stringify(a)===JSON.stringify(b));
export function diffCampaignFrame(before:CampaignFrame,after:CampaignFrame):CampaignDelta{
 const old=new Map(before.snapshot.units.map(u=>[u.id,u]));
 const units:Partial<Unit>[]=[];const positions:[number,number,number][]=[];const indexes=new Map(before.snapshot.units.map((u,i)=>[u.id,i]));
 for(const unit of after.snapshot.units){const previous=old.get(unit.id);old.delete(unit.id);if(!previous){units.push(unit);continue;}
  if(previous.x!==unit.x||previous.y!==unit.y)positions.push([indexes.get(unit.id)!,unit.x,unit.y]);
  const changes:Record<string,unknown>={id:unit.id};let changed=false;
  for(const key of Object.keys(unit) as (keyof Unit)[]){if(key!=='x'&&key!=='y'&&!equal(previous[key],unit[key])){changes[key]=unit[key]??null;changed=true;}}
  for(const key of Object.keys(previous) as (keyof Unit)[])if(!(key in unit)){changes[key]=null;changed=true;}
  if(changed)units.push(changes as Partial<Unit>);
 }
 const snapshot:Record<string,unknown>={};
 for(const key of Object.keys(after.snapshot) as (keyof CampaignFrame['snapshot'])[]){if(key!=='units'&&key!=='map'&&!equal(before.snapshot[key],after.snapshot[key]))snapshot[key]=after.snapshot[key];}
 return {type:'frameDelta',tick:after.snapshot.tick,units,positions,removed:[...old.keys()],snapshot,paused:after.paused,...(!equal(before.state,after.state)?{state:after.state}:{})};
}
export function applyCampaignDelta(before:CampaignFrame,delta:CampaignDelta):CampaignFrame{
 const moved=new Map(delta.positions.map(([i,x,y])=>[before.snapshot.units[i]!.id,{x,y}]));
 const changes=new Map(delta.units.map(u=>[u.id!,u]));const removed=new Set(delta.removed);const units:Unit[]=[];
 for(const unit of before.snapshot.units){if(removed.has(unit.id))continue;const patch=changes.get(unit.id);changes.delete(unit.id);if(!patch){units.push(moved.has(unit.id)?{...unit,...moved.get(unit.id)!}:unit);continue;}
  const merged={...unit,...moved.get(unit.id),...patch};for(const key of Object.keys(merged) as (keyof Unit)[])if(merged[key]===null)delete merged[key];units.push(merged as Unit);
 }
 for(const unit of changes.values())units.push(unit as Unit);
 return {type:'frame',snapshot:{...before.snapshot,...delta.snapshot,units,tick:delta.tick},state:delta.state??before.state,paused:delta.paused};
}

/** Quantization affects transmitted display positions only, never host simulation. */
export function campaignWireFrame(frame:CampaignFrame):CampaignFrame{return {...frame,snapshot:{...frame.snapshot,units:frame.snapshot.units.map(u=>({...u,x:Math.round(u.x*10)/10,y:Math.round(u.y*10)/10}))}};}
