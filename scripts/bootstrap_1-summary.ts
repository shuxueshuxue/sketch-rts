import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { bootstrapMatches } from '../src/ai/bootstrap_1/benchmark';
import type { BenchmarkMatchReport } from '../src/sdk/benchmark/core';

const {values}=parseArgs({options:{input:{type:'string'},mode:{type:'string',default:'candidate'},out:{type:'string',default:'/tmp/bootstrap_1-summary.csv'}}});
const root=resolve(values.input!);
function files(directory:string):string[]{return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(`${directory}/${entry.name}`):[`${directory}/${entry.name}`]);}
const played=files(root).filter(path=>path.includes('.matches/')&&path.endsWith('.json')&&(values.mode==='initial'||path.includes(`bootstrap_1-${values.mode}-`))).map(path=>JSON.parse(readFileSync(path,'utf8')) as BenchmarkMatchReport);
const byName=new Map(played.map(match=>[match.name,match]));
const groups=new Map<string,string[]>();
for(const match of bootstrapMatches('matrix')){
  const key=match.name.split('/').slice(0,3).join(',');
  groups.set(key,[...(groups.get(key)??[]),match.name]);
}
const rows=[...groups].map(([key,names])=>{
  const reports=names.filter(name=>byName.has(name)).map(name=>byName.get(name)!);
  return `${key},${reports.length},${reports.filter(match=>match.result.winner==='p0').length},${reports.filter(match=>match.result.winner!==null&&match.result.winner!=='p0').length},${reports.filter(match=>match.result.timeout).length},${names.length-reports.length}`;
});
writeFileSync(values.out,['map,subject,opponents,completed,wins,losses,timeouts,missing',...rows].join('\n')+'\n');
console.log(JSON.stringify({mode:values.mode,expected:1620,completed:byName.size,wins:played.filter(match=>match.result.winner==='p0').length,losses:played.filter(match=>match.result.winner!==null&&match.result.winner!=='p0').length,timeouts:played.filter(match=>match.result.timeout).length,missing:1620-byName.size,out:values.out}));
