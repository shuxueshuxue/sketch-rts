import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const require=createRequire(resolve('package.json'));
const {build}=require('esbuild');
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.cwd(),work=resolve(process.argv[2]??'work/traffic-sweep-equivalence'),frozen=new Map();
mkdirSync(work,{recursive:true});
const old=execFileSync('git',['show','594f2de:src/shared/ship-avoidance.ts'],{cwd:root,encoding:'utf8'});
const entry=`export {navalStressScenes} from '${root}/scripts/naval-runtime-stress.ts';
export {stepGame,snapshotGame,restoreSnapshotIntoGame} from '${root}/src/shared/sim.ts';
export {checksumGame} from '${root}/src/shared/sim/checksum.ts';
export {shipTraffic,trafficSweepDiagnostic} from '${root}/src/shared/ship-avoidance.ts';
export {createUnit} from '${root}/src/shared/map.ts';
export {shipProfile} from '${root}/src/shared/ship-geometry.ts';
export {shipPoseAt} from '${root}/src/shared/ship-navigation.ts';`;
for(const role of ['before','after'])await build({stdin:{contents:entry,resolveDir:root,sourcefile:'traffic-sweep-pool-entry.mts',loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:work+'/traffic-sweep-pool-'+role+'.mjs',plugins:[{name:'frozen',setup(b){b.onLoad({filter:/\.(?:ts|tsx|json)$/},args=>{
 let source=frozen.get(args.path);if(source===undefined){source=readFileSync(args.path,'utf8');frozen.set(args.path,source);}
 let contents=role==='before'&&args.path.endsWith('/src/shared/ship-avoidance.ts')?old:source;
 if(args.path.endsWith('/src/shared/ship-avoidance.ts')){
  contents='export const trafficSweepDiagnostic={samples:0,allocations:0,track:false,geometries:[]};\n'+contents;
  const capture='if(trafficSweepDiagnostic.track)trafficSweepDiagnostic.geometries.push({polygon:negative,coordinates:negative.map(p=>({x:p.x,y:p.y}))});';
  const anchor='negative=shape.map(p=>({x:-p.x,y:-p.y}));';
  assert.equal(contents.split(anchor).length,2,'unique negative hull capture');contents=contents.replace(anchor,anchor+capture);
  if(role==='before')contents=contents.replace('for(const p of hull)points.push({x:p.x*c-p.y*s,y:p.x*s+p.y*c});','for(const p of hull){trafficSweepDiagnostic.samples++;trafficSweepDiagnostic.allocations++;points.push({x:p.x*c-p.y*s,y:p.x*s+p.y*c});}');
  else contents=contents.replace('const index=points.length;','trafficSweepDiagnostic.samples++;const index=points.length;').replace('trafficSweepScratch[index]={x:0,y:0}','trafficSweepScratch[index]=(trafficSweepDiagnostic.allocations++,{x:0,y:0})').replace(': {x:0,y:0};',': (trafficSweepDiagnostic.allocations++,{x:0,y:0});');
 }
 return {contents,loader:args.path.endsWith('.json')?'json':args.path.endsWith('.tsx')?'tsx':'ts',resolveDir:dirname(args.path)};
});}}]});
const before=await import(work+'/traffic-sweep-pool-before.mjs'),after=await import(work+'/traffic-sweep-pool-after.mjs');
const kinds=['transport','cutter','warship','shipOfTheLine','carrier','fireShip','bombardShip'];
let cases=0;
const scene=module=>{
 const {game}=module.navalStressScenes[0].setup();
 const snapshots=[],hash=createHash('sha256');
 for(let tick=0;tick<600;tick++){
  module.stepGame(game);
  const value=JSON.stringify(module.snapshotGame(game));hash.update(value+'\n');snapshots.push(value);
  if(tick===299)module.restoreSnapshotIntoGame(game,JSON.parse(value),game.nextId);
 }
 return {snapshots,digest:hash.digest('hex'),checksum:module.checksumGame(game)};
};
const first=scene(before),second=scene(after);
assert.deepEqual(second,first);
const queries=module=>{
 const answers=[],held=[];module.trafficSweepDiagnostic.track=true;
 for(const kind of kinds)for(const scale of [1,1.2,3])for(let heading=0;heading<8;heading++){
  const ship=module.createUnit('own','player',kind,2500,2500);ship.deckScale=scale;ship.sailing={heading:heading*Math.PI/4,speed:0,load:0,balance:0};
  const enemy=module.createUnit('obstacle','enemy','shipOfTheLine',0,0);enemy.sailing={heading:.713,speed:0,load:0,balance:0};
  const radius=unit=>Math.max(...module.shipProfile(unit).hull.map(p=>Math.hypot(p.x,p.y)));
  const distance=radius(ship)+radius(enemy)+192;enemy.x=ship.x+distance;enemy.y=ship.y;
  const clear=module.shipTraffic(ship,[ship,enemy],Infinity);
  const from={x:2500,y:2500,heading:ship.sailing.heading};
  for(const yaw of [0,.01,Math.PI/4,-Math.PI/2,Math.PI-1e-8])for(const shift of [0,distance,2*distance]){
   const to={x:from.x+shift,y:from.y,heading:from.heading+yaw};
   answers.push(clear(from,to));
  }
  const pivot={x:from.x-10*Math.cos(from.heading),y:from.y-10*Math.sin(from.heading)};
  const pivotTurn={x:from.x,y:from.y,heading:from.heading+.17,pivot};
  const to=module.shipPoseAt(from,pivotTurn,1);Object.assign(to,{pivot});
  answers.push(clear(from,to));
  for(const yaw of [0,Math.PI/4]){
    const retainedTo={x:from.x+(yaw===0?distance:0),y:from.y,heading:from.heading+yaw};
    held.push({clear,from,to:retainedTo,value:clear(from,retainedTo)});
  }
  assert.equal(clear(from,{...from}),true,'separated stationary hulls');
  assert.equal(clear(from,{x:enemy.x,y:enemy.y,heading:from.heading}),false,'sweep through obstacle center');
 }
 // Reuse early frozen queries after thousands of later sweeps and cache
 // evictions. Scratch vertices must not mutate any retained obstacle hull.
 for(const {clear,from,to,value}of held){assert.equal(clear(from,to),value);answers.push(value);}
 for(const {polygon,coordinates}of module.trafficSweepDiagnostic.geometries){
  assert.equal(polygon.length,coordinates.length);
  for(let i=0;i<polygon.length;i++){
    assert.ok(Object.is(polygon[i].x,coordinates[i].x)&&Object.is(polygon[i].y,coordinates[i].y),'retained negative hull coordinates changed');
  }
 }
 module.trafficSweepDiagnostic.track=false;
 return answers;
};
const oldAnswers=queries(before),newAnswers=queries(after);assert.deepEqual(newAnswers,oldAnswers);cases=oldAnswers.length;
assert.ok(oldAnswers.some(Boolean)&&oldAnswers.some(value=>!value),'both pass and blocked verdicts required');
const sources=Object.fromEntries([...frozen].sort().map(([p,s])=>[p.slice(root.length+1),createHash('sha256').update(s).digest('hex')]));
const changed=[...frozen].filter(([p,s])=>readFileSync(p,'utf8')!==s).map(([p])=>p);assert.equal(changed.length,0);
assert.equal(before.trafficSweepDiagnostic.samples,after.trafficSweepDiagnostic.samples);
assert.ok(after.trafficSweepDiagnostic.allocations<before.trafficSweepDiagnostic.allocations);
const result={schema:1,scope:'Isolated temporary traffic-sweep allocation change. Both bundles use identical frozen dependencies and diagnostic allocation counters and retained negative-hull coordinate observations; no planner scheduling or gameplay changes. Diagnostic runs are not CPU performance measurements.',cases,allVerdictsExact:true,retainedQueries:336,verdictDistribution:{clear:oldAnswers.filter(Boolean).length,blocked:oldAnswers.filter(value=>!value).length},completeJsonTicks:600,jsonRestoreAtTick:300,allSnapshotsExact:true,checksum:first.checksum,snapshotSequenceSha256:first.digest,retainedNegativeHullCount:{before:before.trafficSweepDiagnostic.geometries.length,after:after.trafficSweepDiagnostic.geometries.length},retainedNegativeHullCoordinatesExact:true,temporaryPointCounts:{before:{samples:before.trafficSweepDiagnostic.samples,allocations:before.trafficSweepDiagnostic.allocations},after:{samples:after.trafficSweepDiagnostic.samples,allocations:after.trafficSweepDiagnostic.allocations}},sourceSha256:sources,beforeSha256:createHash('sha256').update(old).digest('hex'),changedDuringRun:changed};
writeFileSync(work+'/traffic-sweep-pool-equivalence.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({cases,checksum:first.checksum,allSnapshotsExact:true,changedDuringRun:changed}));
