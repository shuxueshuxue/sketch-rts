/** Measurement-only complete shoreSpot experiment. Original production sources are never written. */
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { build, version as esbuildVersion } from 'esbuild';
import ts from 'typescript';
import type { GameSnapshot } from '/workspace/sketch-rts-six-player-structural-before-0f31/src/shared/types';

type Input = { tick: number; sequence: number; owner: string; snapshot: GameSnapshot; water: {x:number;y:number}; despiteGuns: boolean;
  teams?: Record<string,string>; scriptId?: string };
type Args = [GameSnapshot, string, {x:number;y:number}, {memory:object;teams?:Record<string,string>}, boolean];
type Api = { run(...args: Args): {x:number;y:number}|undefined; original(...args: Args): {x:number;y:number}|undefined;
  reset(): void; stats(): {walking:number;grow:number;factory:number;multiQuery:number;multiBuild:number};
  facts(...args: Args): unknown };
type Trial = { inputTick:number; owner:string; state:string; group:number; slot:number; variant:'A'|'B'; samplesMs:number[]; resultBytes:string };
const source = '/workspace/sketch-rts-six-player-structural-before-0f31';
const inputsPath = '/workspace/six-player-structural-runs/shore-actual-0f31/shore-inputs.jsonl.gz';
const captureEnvironmentPath = '/workspace/six-player-structural-runs/shore-actual-0f31/environment.json';
const toolPath = fileURLToPath(import.meta.url), toolRoot = dirname(toolPath);
const require = createRequire(import.meta.url);
const sha = (bytes:string|Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const gitHead = () => execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const out = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass a fresh output directory');
try { await access(out); throw new Error(`Refusing existing ${out}`); }
catch(error) { if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
await mkdir(out,{recursive:true});
const capturedBytes = await readFile(inputsPath), capturedPayload = gunzipSync(capturedBytes);
const inputs = capturedPayload.toString('utf8').trim().split('\n').map(line=>JSON.parse(line) as Input);
assert.equal(inputs.length,2);assert.deepEqual(inputs.map(input=>input.tick),[6990,12705]);
const originalHead = gitHead();assert.equal(originalHead,'0f31f16c32e9a8050180c4da9d993eb7bf86cad0');
const originalInputs = new Map<string,string>();
const sourcePath = join(source,'src/ai/policy/naval.ts'), terrainPath = join(source,'src/shared/terrain.ts');
const naval = await readFile(sourcePath,'utf8'), terrain = await readFile(terrainPath,'utf8');
const ast = ts.createSourceFile(sourcePath,naval,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const shore = ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='shoreSpot') as ts.FunctionDeclaration|undefined;
if(!shore?.body)throw new Error('shoreSpot boundary changed');
const originalFunction = naval.slice(shore.getStart(ast),shore.end);
const originalExpression = 'const gapOf = (spot: Point, from: Building[]) => Math.min(Infinity, ...from.map((hall) => walkingDistance(map, spot, hall) ?? Infinity));';
assert.equal(originalFunction.split(originalExpression).length,2);
const candidateFunction = originalFunction.replace(originalExpression,
  'const enemyGap = __shoreExperimentEnemyGap(map, theirs);\n    const gapOf = (spot: Point, from: Building[]) => from === theirs ? enemyGap(spot) : Math.min(Infinity, ...from.map((hall) => walkingDistance(map, spot, hall) ?? Infinity));');
const metadataNames = ['walking','grow','factory','multiQuery','multiBuild'];
const counterDeclaration = `const __shoreExperimentCounts = {walking:0,grow:0,factory:0,multiQuery:0,multiBuild:0};`;
// Only scratch B uses this owned distance field. It is not stored in/recycled through state.fields, and its next array
// never selects a route. Cache has exactly the measured source sets; it is not a production cache/API proposal.
function multiHelper(counted:boolean) {
  return `
const __shoreExperimentGroups = new WeakMap<TerrainRuntime,Map<string,Field>>();
export function __shoreExperimentEnemyGap(map:Pick<GameMap,'terrain'>,origins:readonly Point[]) {
  ${counted?'__shoreExperimentCounts.factory++;':''}
  if(origins.length<=1 || !map.terrain)return (point:Point)=>Math.min(Infinity,...origins.map(origin=>walkingDistance(map,point,origin)??Infinity));
  const state=runtime(map.terrain,'land');
  const seeds=[...new Set(origins.map(origin=>padAt(state,origin.x,origin.y)).filter(at=>state.walk[at]===1))].sort((a,b)=>a-b);
  const key=seeds.join(',');let field:Field|undefined;
  return (point:Point)=>{
    ${counted?'__shoreExperimentCounts.multiQuery++;':''}
    const start=padAt(state,point.x,point.y);
    if(state.walk[start]!==1 || seeds.length===0)return Infinity;
    if(!field){
      let groups=__shoreExperimentGroups.get(state);
      if(!groups){groups=new Map();__shoreExperimentGroups.set(state,groups);}
      field=groups.get(key);
      if(!field){field=grow(state,seeds);groups.set(key,field);${counted?'__shoreExperimentCounts.multiBuild++;':''}}
    }
    const cost=field.dist[start]!;
    return cost>=UNREACHED?Infinity:cost*state.terrain.cell/STRAIGHT;
  };
}
`;
}
function terrainCounters(text:string) {
  const tree=ts.createSourceFile(terrainPath,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const edits:{at:number;text:string}[]=[];
  for(const node of tree.statements)if(ts.isFunctionDeclaration(node)&&node.name&&node.body){
    const name=node.name.text==='walkingDistance'?'walking':node.name.text==='grow'?'grow':undefined;
    if(name)edits.push({at:node.body.getStart(tree)+1,text:`\n__shoreExperimentCounts.${name}++;\n`});
  }
  assert.equal(edits.length,2);
  for(const edit of edits.sort((a,b)=>b.at-a.at))text=text.slice(0,edit.at)+edit.text+text.slice(edit.at);
  return text;
}
async function bundle(variant:'A'|'B',counted:boolean) {
  const id=`${variant}-${counted?'counts':'timed'}`;
  let navalOverride=naval;
  if(variant==='B')navalOverride=naval.slice(0,shore!.getStart(ast))+candidateFunction+naval.slice(shore!.end)
    +"\nimport {__shoreExperimentEnemyGap} from '../../shared/terrain';\n";
  navalOverride+='\n'+originalFunction.replace(/^function shoreSpot\(/,'function __shoreExperimentOriginal(');
  navalOverride+=`\nexport {shoreSpot as run,__shoreExperimentOriginal as original};
export function facts(snapshot:GameSnapshot,owner:PlayerId,water:Point,options:AiPolicyContext){
 const ours=buildings(snapshot,owner).filter(building=>building.kind==='townHall');
 const theirs=snapshot.buildings.filter(building=>building.kind==='townHall'&&isOpponentOwner(snapshot,owner,building.owner,options));
 return {shores:shoreSpots(snapshot.map,BUILDING_DEFS.shipyard.radius).length,ours:ours.map(hall=>({id:hall.id,x:hall.x,y:hall.y})),theirs:theirs.map(hall=>({id:hall.id,x:hall.x,y:hall.y}))};}
export {__shoreExperimentReset as reset,__shoreExperimentStats as stats} from '../../shared/terrain';\n`;
  let terrainOverride=(counted?terrainCounters(terrain):terrain)+'\n'+counterDeclaration;
  if(variant==='B')terrainOverride+=multiHelper(counted);
  terrainOverride+=`\nexport function __shoreExperimentReset(){for(const key of Object.keys(__shoreExperimentCounts) as (keyof typeof __shoreExperimentCounts)[])__shoreExperimentCounts[key]=0;}
export function __shoreExperimentStats(){return {...__shoreExperimentCounts};}\n`;
  const built=await build({entryPoints:[sourcePath],bundle:true,write:false,platform:'node',format:'cjs',target:'node22',metafile:true,
    plugins:[{name:'scratch-complete-shore-input-experiment',setup(builder){builder.onLoad({filter:/\.ts$/},async args=>{
      if(!args.path.startsWith(join(source,'src')+'/'))return undefined;
      const text=await readFile(args.path,'utf8');const name=relative(source,args.path);
      const previous=originalInputs.get(name);if(previous!==undefined)assert.equal(text,previous);else originalInputs.set(name,text);
      return {contents:args.path===sourcePath?navalOverride:args.path===terrainPath?terrainOverride:text,loader:'ts'};
    });}}]});
  const code=built.outputFiles[0]!.text;
  await writeFile(join(out,`${id}.cjs.gz`),gzipSync(code));
  await writeFile(join(out,`${id}-naval.ts.gz`),gzipSync(navalOverride));
  await writeFile(join(out,`${id}-terrain.ts.gz`),gzipSync(terrainOverride));
  const initialize=new Function('module','exports','require',code);
  return {id,codeSha256:sha(code),navalSha256:sha(navalOverride),terrainSha256:sha(terrainOverride),factory:()=>{
    const module={exports:{}};initialize(module,module.exports,require);return module.exports as Api;
  }};
}
const artifacts=[await bundle('A',false),await bundle('B',false),await bundle('A',true),await bundle('B',true)];
const timed={A:artifacts[0]!,B:artifacts[1]!},counted={A:artifacts[2]!,B:artifacts[3]!};
const toArgs=(input:Input):Args=>[input.snapshot,input.owner,input.water,{memory:{},...(input.teams?{teams:input.teams}:{})},input.despiteGuns];
const serializeResult=(result:ReturnType<Api['run']>)=>result===undefined?'undefined':JSON.stringify(result);
const inputBytes=inputs.map(input=>JSON.stringify(input));
const expected=inputs.map(input=>serializeResult(timed.A.factory().original(...toArgs(input))));
const states=['all-cold','old-fields-warm-multi-cold','all-warm'] as const;
const diagnostics:unknown[]=[];
for(const [index,input] of inputs.entries())for(const state of states)for(const variant of ['A','B'] as const){
  const api=counted[variant].factory(),args=toArgs(input);
  if(state!=='all-cold')api.original(...args);
  if(state==='all-warm')api.run(...args);
  api.reset();const result=api.run(...args);
  assert.equal(serializeResult(result),expected[index]);
  diagnostics.push({tick:input.tick,owner:input.owner,state,variant,counts:api.stats(),facts:api.facts(...args),resultBytes:serializeResult(result)});
  assert.equal(JSON.stringify(input),inputBytes[index]);
}
const trials:Trial[]=[];
// Each ABBA slot has an independent fresh game-module runtime. Instrumented counting bundles never supply timings.
for(const state of states)for(let group=0;group<5;group++)for(const [index,input] of inputs.entries()){
  const order=['A','B','B','A'] as const;
  for(const [slot,variant] of order.entries()){
    const api=timed[variant].factory(),args=toArgs(input),samplesMs:number[]=[];
    if(state!=='all-cold')assert.equal(serializeResult(api.original(...args)),expected[index]);
    if(state==='all-warm')assert.equal(serializeResult(api.run(...args)),expected[index]);
    const repeats=state==='all-warm'?40:1;
    let resultBytes='';
    for(let repeat=0;repeat<repeats;repeat++){
      const started=performance.now();const result=api.run(...args);samplesMs.push(performance.now()-started);
      resultBytes=serializeResult(result);assert.equal(resultBytes,expected[index]);
    }
    assert.equal(JSON.stringify(input),inputBytes[index]);
    assert.equal(JSON.stringify(args[3]),JSON.stringify({memory:{},...(input.teams?{teams:input.teams}:{})}));
    trials.push({inputTick:input.tick,owner:input.owner,state,group,slot,variant,samplesMs,resultBytes});
  }
}
function distribution(values:number[]) {
  const sorted=[...values].sort((a,b)=>a-b),at=(fraction:number)=>sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)]??0;
  return {count:sorted.length,median:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)??0,mean:sorted.reduce((a,b)=>a+b,0)/sorted.length};
}
const rows=inputs.flatMap(input=>states.map(state=>{
  const subset=trials.filter(trial=>trial.inputTick===input.tick&&trial.state===state);
  return {tick:input.tick,owner:input.owner,state,A:distribution(subset.filter(t=>t.variant==='A').flatMap(t=>t.samplesMs)),
    B:distribution(subset.filter(t=>t.variant==='B').flatMap(t=>t.samplesMs)),groups:Array.from({length:5},(_,group)=>{
      const members=subset.filter(t=>t.group===group);
      return {group,A:distribution(members.filter(t=>t.variant==='A').flatMap(t=>t.samplesMs)),B:distribution(members.filter(t=>t.variant==='B').flatMap(t=>t.samplesMs))};
    })};
}));
for(const [name,text] of originalInputs)assert.equal(await readFile(join(source,name),'utf8'),text);
assert.equal(gitHead(),originalHead);assert.equal(sha(await readFile(inputsPath)),sha(capturedBytes));
const sourceManifest=[...originalInputs].sort(([a],[b])=>a.localeCompare(b)).map(([path,text])=>({path,bytes:Buffer.byteLength(text),sha256:sha(text)}));
const summary={complete:true,source,sourceHead:originalHead,inputsPath,storedInputSha256:sha(capturedBytes),inputPayloadSha256:sha(capturedPayload),
  capturedEnvironmentSha256:sha(await readFile(captureEnvironmentPath)),toolSha256:sha(await readFile(toolPath)),sourceManifestSha256:sha(JSON.stringify(sourceManifest)),
  artifacts:artifacts.map(({factory:_,...metadata})=>metadata),node:process.version,v8:process.versions.v8,esbuild:esbuildVersion,typescript:ts.version,cpus:cpus(),
  rows,diagnostics,expectedResultBytes:expected,trials:trials.length,totalMeasuredCalls:trials.reduce((sum,trial)=>sum+trial.samplesMs.length,0),
  method:{groups:5,order:'ABBA',completeFunction:'Actual entire original shoreSpot vs same function with only theirs using lazy 5/7 source-set field. Ours retains original gapOf/map/spread and walkingDistance queries.',
    cold:'Independent fresh module/runtime in every slot; first complete function call, including native terrain/shore/single fields and any candidate multi build.',
    oldWarmNewCold:'Original full shoreSpot prewarms the same module runtime once outside timer. Candidate multi source-set field is still absent on timed call.',
    warm:'Original and candidate complete functions prewarm outside timer; then forty full calls timed individually.',
    counts:'Separate counting bundles and invocations. No per-query counters/timers occur in the measured bundles.',
    candidateScope:'Scratch only. Private actual grow is reused, sorted valid source cells, scalar min only, owned field not in state.fields/spare pool. Fields persist only in this scratch module for these fixed measured source sets; no production API/cache is proposed.',
    limits:'Two captured real inputs; isolated native Node function timing, not a full tick/browser comparison or proof of the main-thread budget. No forced GC; GC/scheduling can enter measured outliers. Build/load/input serialization/assertions/output excluded from each call timer.'}};
await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));
await writeFile(join(out,'trials.json.gz'),gzipSync(JSON.stringify(trials)));
await writeFile(join(out,'source-inputs.json.gz'),gzipSync(JSON.stringify(Object.fromEntries(originalInputs))));
await writeFile(join(out,'source-manifest.json'),JSON.stringify(sourceManifest,null,2));
await writeFile(join(out,'captured-inputs.jsonl.gz'),capturedBytes);
await writeFile(join(out,'experiment-source.ts'),await readFile(toolPath));
await writeFile(join(out,'report.json'),JSON.stringify({rows:rows.map(({groups:_,...row})=>row),expected,diagnostics,trials:summary.trials,totalMeasuredCalls:summary.totalMeasuredCalls},null,2));
const names=(await import('node:fs/promises')).readdir;
const files=(await names(out)).sort();
const manifest=[];
for(const name of files){const bytes=await readFile(join(out,name));manifest.push({name,bytes:bytes.length,sha256:sha(bytes)});}
await writeFile(join(out,'closed-manifest.json'),JSON.stringify({fileNames:files,assets:manifest,excludedDependencyLink:'node_modules'},null,2));
console.log(JSON.stringify({complete:true,rows:rows.map(({groups:_,...row})=>row),trials:summary.trials,totalMeasuredCalls:summary.totalMeasuredCalls},null,2));
