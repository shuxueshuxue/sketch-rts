// Run with node --import tsx from the repository root. This is a standalone
// evidence probe, not a CI test or a permanent copy of the baseline renderer.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const options=new Map();
for(let index=2;index<process.argv.length;index+=2){
  const name=process.argv[index],value=process.argv[index+1];
  if(!['--baseline','--current','--output'].includes(name)||!value)throw new Error('Usage: --baseline <git-ref> --current <source-file> [--output <result.json>]');
  options.set(name,value);
}
const repo=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const sourcePath='src/client/unit-animation.ts',baselineRef=options.get('--baseline')??'5eb401d';
const baselineCommit=execFileSync('git',['rev-parse',baselineRef],{cwd:repo,encoding:'utf8'}).trim();
const baselineSource=execFileSync('git',['show',`${baselineRef}:${sourcePath}`],{cwd:repo,encoding:'utf8'});
const currentPath=resolve(repo,options.get('--current')??sourcePath),currentSource=readFileSync(currentPath,'utf8');
const sha256=source=>createHash('sha256').update(source).digest('hex');
const temporary=mkdtempSync(join(tmpdir(),'sketch-rts-animation-equivalence-'));
try {
  const modulePath=join(temporary,'baseline.ts');
  // The baseline source uses the same catalog/art dependencies as current. This
  // isolates tracker storage/history changes from unrelated asset changes.
  writeFileSync(modulePath,baselineSource.replace(/(from\s+)(['"])(\.[^'"]+)\2/g,(_match,prefix,_quote,relative)=>prefix+JSON.stringify(resolve(repo,dirname(sourcePath),relative))));
  const baselineModule=await import(pathToFileURL(modulePath).href),currentModule=await import(pathToFileURL(currentPath).href);
  const Baseline=baselineModule.UnitAnimationTracker??baselineModule.default.UnitAnimationTracker;
  const Current=currentModule.UnitAnimationTracker??currentModule.default.UnitAnimationTracker;
  const {UNIT_RULES}=await import(pathToFileURL(join(repo,'src/shared/catalog.ts')).href);
const kinds=Object.keys(UNIT_RULES);
const units=kinds.map((kind,index)=>({id:`trace-${index}`,kind,owner:'player',x:100+index*3,y:100-index,hp:100,maxHp:100,speed:80,attackDamage:10,attackRange:30,attackCooldown:20,cooldown:0,radius:12,carryingGold:0,kills:0,xp:0,level:0,effects:[],order:{type:'idle'}}));
const baseline=new Baseline(),current=new Current();
let comparisons=0,tick=0;
const hash=createHash('sha256');
const release=(unit,id,mode,index)=>({
  id,sourceId:unit.id,type:mode==='attack'?'melee':'heal',actionMode:mode,actionTick:tick,
  x:unit.x,y:unit.y,fromX:unit.x,fromY:unit.y,toX:unit.x+(index%3-1)*30,toY:unit.y+(index%2?-60:60),
  fromHeight:5,toHeight:5+index%3*20,duration:16,remaining:16,
});
const compare=(at,active,reducedMotion=false)=>{
  const a=[],b=[];
  const visitsA=baseline.observeDirections(at,(id,direction)=>a.push([id,direction]),reducedMotion),visitsB=current.observeDirections(at,(id,direction)=>b.push([id,direction]),reducedMotion);
  assert.equal(visitsB,visitsA);assert.deepEqual(b,a);
  hash.update(JSON.stringify(a));comparisons++;
  for(const unit of active){
    const actual=current.frame(unit,at),expected=baseline.frame(unit,at);
    assert.deepEqual(actual,expected,`${unit.id}:${unit.kind} tick ${tick} at ${at}`);
    hash.update(JSON.stringify(expected));comparisons++;
  }
};
for(let step=0;step<300;step++){
  tick=step===95?tick+15:step===140?20:tick+1;
  const effects=[];
  for(const [index,unit] of units.entries()){
    if(step%9<6)unit.x+=index%2?1.3:-1.3;
    if(index%5===0){
      if(step%13<9)unit.deck={shipId:`ship-${Math.floor(step/13)}`,x:step%5*2,y:index};else delete unit.deck;
    }
    unit.cooldown=step%13===0?20:Math.max(0,unit.cooldown-1);
    if(step%23<6)unit.abilityCooldowns={charge:100-step%23};
    else if(step%23<14)unit.abilityCooldowns={heal:100-step%23,stomp:step%11};else delete unit.abilityCooldowns;
    unit.hp=step%31===30?0:100;
    unit.effects=step%17===16?[{type:'stun',remaining:3}]:[];
    if(step%19===18)unit.pushX=0;else delete unit.pushX;
    if(unit.kind==='worker'){
      unit.order=step%14<10?{type:'mine',resourceId:`mine-${Math.floor(step/9)}`,phase:'gather',timer:20-step%14}:{type:'repair',buildingId:'hall'};
      if(step%7===0)effects.push({id:`repair-${step}`,type:'repair',unitId:unit.id,x:unit.x,y:unit.y,duration:13,remaining:13});
    }else unit.order=step%3===0?{type:'attack',targetId:'behind'}:{type:'hold',x:unit.x,y:unit.y};
    if(step%11===0)effects.push(release(unit,`release-${step}-${index}`,index%4===0?'cast':'attack',index));
  }
  const active=step%21===20?units.slice(4):units;
  const state={tick,units:active,effects},now=step*50;
  baseline.update(state,now);current.update(state,now);
  for(const offset of [0,17,50,10000])compare(now+offset,active,step%37===36);
  if(step%6===0){
    effects.push(release(units[0],`append-${step}`,'attack',step));
    baseline.update(state,now);current.update(state,now);compare(now+20,active);
  }
  if(step%10===0){
    const cues=[{unitId:units[1].id,mode:step%20?'attack':'cast',tick,fromX:100,fromY:100,toX:step%20?0:100,toY:170}];
    baseline.update(state,now,cues);current.update(state,now,cues);compare(now+35,active);
  }
}
const result={
  baseline:{ref:baselineRef,commit:baselineCommit,sourcePath,sourceSha256:sha256(baselineSource)},
  current:{sourcePath:currentPath,sourceSha256:sha256(currentSource),repositoryHead:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()},
  kinds:kinds.length,steps:300,publicComparisons:comparisons,traceSha256:hash.digest('hex'),
  result:'all public frames and direction callbacks equal',
};
const output=JSON.stringify(result,null,2)+'\n';
if(options.has('--output'))writeFileSync(resolve(repo,options.get('--output')),output);
console.log(output);
} finally { rmSync(temporary,{recursive:true,force:true}); }
