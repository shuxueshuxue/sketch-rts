/** Reproducible real-unit stress probe. No HP inflation, frozen actors or visual-only troops.
 * node --import tsx scripts/army-scale-probe.ts --units 5000 --ticks 200 --out docs/reviews/army-scale-baseline.json
 * Profiles: node --cpu-prof --cpu-prof-dir=/tmp --import tsx scripts/army-scale-probe.ts ...
 * Excludes rendering, networking and strategic AI; unit combat AI/pathing/collision remain active.
 */
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createGame, snapshotGame, stepGame } from '../src/shared/sim';
import { SIM_TICKS_PER_SECOND } from '../src/shared/time';
import type { UnitKind } from '../src/shared/types';
const args=process.argv.slice(2);
const flag=(name:string)=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1];};
const count=Number(flag('units')??5000),ticks=Number(flag('ticks')??200),repeat=Number(flag('repeat')??1);
if(!Number.isInteger(count)||count<100||count>20000||count%2||!Number.isInteger(ticks)||ticks<1||ticks>2000||!Number.isInteger(repeat)||repeat<1||repeat>5)throw Error('Invalid probe size, ticks or repeat');
const scenarios=['march','battle','fronts'] as const;
type Scenario=typeof scenarios[number];
const requested=flag('scenario');if(requested&&!scenarios.includes(requested as Scenario))throw Error('Unknown scenario');
function make(scenario:Scenario){
 const g=createGame('bareDuel',{aiPlayers:[]});g.scriptedVictory=true;
 g.units=[];g.buildings=[];g.resources=[];g.items=[];g.mercenaryCamps=[];g.projectiles=[];g.effects=[];
 g.map.width=g.map.height=8192;g.map.landmarks=[];
 const cols=256,rows=256;
 g.map.terrain={cell:32,cols,rows,cells:Array.from({length:rows},(_,y)=>Array.from({length:cols},(_,x)=>scenario==='march'&&x===128&&y%48>12?'T':'.').join('')).join('')};
 for(let i=0;i<count;i++){
  const side=i<count/2?0:1, index=i%(count/2),owner=side?'enemy':'player';
  const kinds:UnitKind[]=['footman','footman','lancer','footman','archer','footman','knight','archer','priest','footman'];
  const kind=scenario==='march'?'footman':kinds[index%kinds.length]!;
  let x:number,y:number,targetX:number,targetY:number;
  if(scenario==='march'){
   x=640+(i%80)*34;y=500+Math.floor(i/80)*64;
   targetX=x+3900;targetY=y;
  }else{
   const lanes=scenario==='fronts'?5:1,lane=index%lanes,k=Math.floor(index/lanes);
   const frontage=scenario==='fronts'?20:70;
   x=4096+(side?1:-1)*(25+Math.floor(k/frontage)*30);
   y=scenario==='fronts'?700+lane*1350+(k%frontage)*28:2200+(k%frontage)*28;
   targetX=4096+(side?-1:1)*900;targetY=y;
  }
  const u=g.spawnUnit(owner,kind,x,y);
  u.order={type:scenario==='march'?'move':'attackMove',x:targetX,y:targetY};
 }
 return g;
}
const quantile=(values:number[],q:number)=>{const v=[...values].sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.floor(v.length*q))]!;};
const results=[];
for(const scenario of scenarios.filter(s=>!requested||s===requested))for(let run=0;run<repeat;run++){
 const game=make(scenario),times:number[]=[],hash=createHash('sha256');let peakProjectiles=0,peakEffects=0;
 const startHp=game.units.reduce((n,u)=>n+u.hp,0),origin=new Map(game.units.map(u=>[u.id,{x:u.x,y:u.y}]));
 const cpu=process.cpuUsage();let simMs=0;
 for(let tick=0;tick<ticks;tick++){
  const start=performance.now();stepGame(game);const ms=performance.now()-start;times.push(ms);simMs+=ms;
  peakProjectiles=Math.max(peakProjectiles,game.projectiles.length);peakEffects=Math.max(peakEffects,game.effects.length);
  // Full precision, preserves array order. Digest work excluded from step times.
  if(tick%20===0||tick===ticks-1)hash.update(JSON.stringify(snapshotGame(game)));
 }
 const used=process.cpuUsage(cpu),samples=times.slice(Math.min(20,Math.floor(times.length/4)));
 const serialStart=performance.now(),snapshot=snapshotGame(game),snapshotMs=performance.now()-serialStart;
 const encodeStart=performance.now(),json=JSON.stringify(snapshot),encodeMs=performance.now()-encodeStart;
 const result={scenario,run,initialUnits:count,ticks,simulatedSeconds:ticks/SIM_TICKS_PER_SECOND,remaining:game.units.length,corpses:game.corpses?.length??0,
  moved:game.units.filter(u=>Math.hypot(u.x-origin.get(u.id)!.x,u.y-origin.get(u.id)!.y)>10).length,
  lostHpIncludingDeaths:startHp-game.units.reduce((n,u)=>n+u.hp,0),peakProjectiles,peakEffects,
  stepMeanMs:simMs/ticks,steadyP50Ms:quantile(samples,.5),steadyP95Ms:quantile(samples,.95),worstStepMs:Math.max(...times),
  ticksOver50Ms:times.filter(t=>t>50).length,realtimeRatio:(ticks/SIM_TICKS_PER_SECOND)/(simMs/1000),cpuIncludingDigestsMs:(used.user+used.system)/1000,
  snapshotMs,encodeMs,snapshotBytes:Buffer.byteLength(json),rssMiB:process.memoryUsage().rss/1048576,digest:hash.digest('hex')};
 results.push(result);console.log(JSON.stringify(result));
}
const report={node:process.version,cpu:cpus()[0]?.model,logicalCpus:cpus().length,tickBudgetMs:1000/SIM_TICKS_PER_SECOND,
 scope:'Headless deterministic sim only. Includes real terrain/pathing/collision, tactical unit AI, ordinary HP, combat, projectiles and corpses. Excludes strategic AI, rendering, network and digest work from step timings. 20 startup ticks excluded from steady percentiles.',results};
const out=flag('out');if(out){mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n');}
