import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { bootstrapMatches } from '../src/ai/bootstrap_1/benchmark';
import { runBenchmarkParallel } from '../src/sdk/benchmark/parallel';
import type { MapId } from '../src/shared/types';

const {values} = parseArgs({options:{
  maps:{type:'string'}, subjects:{type:'string'}, opponents:{type:'string'},side:{type:'string'},race:{type:'string'},
  seed:{type:'string',default:'bootstrap_1-development'},ticks:{type:'string',default:'48000'},workers:{type:'string',default:'4'},
  out:{type:'string',default:'.playtest/bootstrap_1/report.json'},'dry-run':{type:'boolean'},unseen:{type:'boolean'},baseline:{type:'boolean'},
}});
const matches = bootstrapMatches(values.seed,values.maps?.split(',') as MapId[]|undefined,Number(values.ticks),values.unseen)
  .filter(match=>values.subjects===undefined || values.subjects.split(',').includes(match.subject))
  .filter(match=>values.opponents===undefined || values.opponents.split(',').includes(Object.values(match.agents).slice(1).map(agent=>agent.version).join('+')))
  .filter(match=>values.side===undefined || match.side===Number(values.side))
  .filter(match=>values.race===undefined || match.agents.p0!.race===values.race);
if(values.baseline)for(const match of matches)match.agents.p0!.policyVersion=match.subject==='v9_archer'?'v5':match.subject==='v9_summoner'?'v7':'v8';
console.log(JSON.stringify({name:'bootstrap_1',baseline:values.baseline===true,games:matches.length,seed:values.seed,unseen:values.unseen===true,maps:[...new Set(matches.map(match=>match.mapId))]}));
if (!values['dry-run']) {
  mkdirSync(dirname(values.out),{recursive:true});
  mkdirSync(values.out+'.matches',{recursive:true});
  writeFileSync(values.out+'.metadata.json',JSON.stringify({name:'bootstrap_1',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).length>0,seed:values.seed,baseline:values.baseline===true,unseen:values.unseen===true,matches:matches.map(({name})=>name)},null,2)+'\n');
  let completed=0;
  const report = await runBenchmarkParallel({name:'bootstrap_1',evaluations:[{name:'full-matrix',tag:'melee',matches}]},{
    workerModule:new URL('../src/ai/bootstrap_1/worker.ts',import.meta.url).href,workers:Number(values.workers),
    onMatch:match=>{
      writeFileSync(`${values.out}.matches/${encodeURIComponent(match.name)}.json`,JSON.stringify(match)+'\n');
      console.log(JSON.stringify({completed:++completed,total:matches.length,name:match.name,winner:match.result.winner,tick:match.result.tick,cpuMs:match.cpuMs}));
    },
  });
  const rows = report.evaluations[0]!.matches.map(match=>({name:match.name,winner:match.result.winner,tick:match.result.tick,timeout:match.result.timeout}));
  writeFileSync(values.out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({wins:rows.filter(row=>row.winner==='p0').length,games:rows.length,elapsedMs:report.elapsedMs,rows},null,2));
  process.exitCode=!values.baseline && rows.some(row=>row.winner!=='p0') ? 1 : 0;
}
