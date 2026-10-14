import {createForestHorde} from '/workspace/sketch-rts-homepage-board/src/client/menu-forest-horde';
const run=createForestHorde();
let worst={gap:Infinity,time:0,ids:[] as string[],kinds:[] as string[]};
let maxstep=0;const pairs=new Map<string,unknown>();
let old=new Map(run.game.units.map(u=>[u.id,{x:u.x,y:u.y}]));
for(let frame=0;frame<=51*30;frame++){
 const time=frame/30;run.script(run.game,time);
 const us=run.game.units;
 for(const u of us){const prev=old.get(u.id);if(prev)maxstep=Math.max(maxstep,Math.hypot(u.x-prev.x,u.y-prev.y));}
 old=new Map(us.map(u=>[u.id,{x:u.x,y:u.y}]));
 for(let i=0;i<us.length;i++)for(let j=i+1;j<us.length;j++){
  const a=us[i]!,b=us[j]!,gap=Math.hypot(a.x-b.x,a.y-b.y)-a.radius-b.radius;
  if(gap<0){const k=[a.id,b.id].join('/');const previous:any=pairs.get(k);if(!previous||gap<previous.gap)pairs.set(k,{gap,time,ids:[a.id,b.id],kinds:[a.kind,b.kind]});}
  if(gap<worst.gap)worst={gap,time,ids:[a.id,b.id],kinds:[a.kind,b.kind]};
 }
}
const sampled=[];
for(const time of [0,6,8.15,10.35,13.3,16.7,17.6,24.6,31.6,35.4,45]){
 run.script(run.game,time);sampled.push({time,units:run.game.units.length,corpses:run.game.corpses!.length,effects:run.game.effects.length,cues:run.actions!().length,fatal:run.game.effects.filter(e=>e.targetHpAfter===0).map(e=>[e.unitId,e.sourceId,e.sourceKind])});
}
console.log(JSON.stringify({worst,maxstep,pairs:[...pairs.values()].sort((a:any,b:any)=>a.gap-b.gap),sampled},null,2));
