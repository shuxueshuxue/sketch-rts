// Diagnostic counts, or every-tick state validation; not a performance acceptance runner.
import { build } from 'esbuild';
import ts from 'typescript';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const [sourceArg, outArg, mode = 'counts'] = process.argv.slice(2);
if (!sourceArg || !outArg || !['counts', 'state'].includes(mode)) throw Error('source out [counts|state]');
const source = resolve(sourceArg), out = resolve(outArg);
await mkdir(out); // Never overwrite a run.
const originals = {}, ticks = [], commands = [], states = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let current;
globalThis.__sanity = {
  enter(name, work) {
    if (!current) return;
    const value = current.costs[name] ??= { calls: 0, ms: 0, work: 0, maxWork: 0 };
    value.calls++; value.work += work; value.maxWork = Math.max(value.maxWork, work);
    return { value, start: performance.now() };
  },
  leave(mark) { if (mark) mark.value.ms += performance.now() - mark.start; },
};
const watched = {
  'src/shared/navigation-math.ts': { convexHull: 'points.length', minkowskiSum: 'a.length+b.length', expandConvex: 'polygon.length' },
  'src/shared/ship-navigation.ts': { planShipRouteImpl: 'state?.nodes?.length ?? 0', arrivalConnectorFor: '0', hullPassageClear: '0' },
  'src/shared/ship-collisions.ts': { sweepShipCollision: '0', sweepShape: '0', prepareSweep: '0', terrainContact: '0', nearby: '0', beginShipCollisionFrame: 'units.length' },
  'src/shared/terrain.ts': { grow: 'state.walk.length', growBoxInto: '0', createRuntime: 'terrain.cols*terrain.rows', walkingDistance: '0', setBuildingBodies: 'bodies.length' },
};
const hooks = [];
function instrument(file, text) {
  const names = watched[file];
  if (!names || mode !== 'counts') return text;
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.body || !node.name || !(node.name.text in names)) continue;
    const name = node.name.text;
    hooks.push({ file, name, work: names[name] });
    edits.push([node.body.getStart(ast)+1, `\nconst __mark=globalThis.__sanity.enter(${JSON.stringify(name)},${names[name]});try {\n`]);
    edits.push([node.body.end-1, '\n}finally{globalThis.__sanity.leave(__mark);}\n']);
  }
  for (const [at, insert] of edits.sort((a,b)=>b[0]-a[0])) text = text.slice(0,at)+insert+text.slice(at);
  return text;
}
const entry = [
  ['StaticSoloDeploymentRuntime', 'src/client/deployment/static-runtime.ts'],
  ['CommandFrameRuntime', 'src/shared/sim/command-frame-runtime.ts'],
  ['checksumGame, CHECKSUM_VERSION', 'src/shared/sim/checksum.ts'],
  ['RULES_VERSION', 'src/shared/rules-version.ts'],
].map(([names,file])=>`export {${names}} from ${JSON.stringify(join(source,file))};`).join('\n');
await build({ stdin: { contents:entry, resolveDir:source, loader:'ts' }, bundle:true, platform:'node', format:'esm', target:'node22', outfile:join(out,'runtime.mjs'),
  plugins:[{name:'sanity-costs',setup(builder){builder.onLoad({filter:/\.ts$/},async args=>{
    if(!args.path.startsWith(join(source,'src')+'/'))return;
    const text=await readFile(args.path,'utf8'), file=relative(source,args.path); originals[file]=text;
    return { contents:instrument(file,text), loader:'ts' };
  });}}] });
const api = await import(pathToFileURL(join(out,'runtime.mjs')));
let frame, now=0;
const original=api.CommandFrameRuntime.prototype.tick;
api.CommandFrameRuntime.prototype.tick=function(...args){return frame=original.apply(this,args);};
const roomInput={id:'six-player-perf-512',host:{id:'six-player-probe-host',name:'Idle human'},mapId:'sapphireArchipelago',humanCount:1,aiCount:5};
const runtime=new api.StaticSoloDeploymentRuntime({now:()=>now,tickMs:50});
await runtime.createRoom(roomInput);
const match=await runtime.startRoom(roomInput.id,roomInput.host), game=match.adapter.game;
const started=performance.now();
for(let tick=0;tick<14400;tick++) {
  current={tick,costs:{}}; frame=undefined; now+=50;
  const t=performance.now();
  if(!match.adapter.updateToRenderTime() || game.tick!==tick+1)throw Error(`tick ${tick}`);
  current.ms=performance.now()-t;
  const snapshot=match.adapter.currentSnapshot();
  commands.push(JSON.stringify({tick,frame:frame??null})+'\n');
  if(mode==='state' && [9658,9659,9660].includes(tick)) await writeFile(join(out,`snapshot-after-${tick}.json.gz`),gzipSync(JSON.stringify(snapshot)));
  if(mode==='state')states.push({tick:game.tick,checksum:api.checksumGame(game),snapshotSha256:sha(JSON.stringify(snapshot))});
  ticks.push(current);current=undefined;
}
const summary={mode,head:execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(), rulesVersion:api.RULES_VERSION,checksumVersion:api.CHECKSUM_VERSION,
  finalChecksum:api.checksumGame(game),commandSha256:sha(commands.join('')),elapsedMs:performance.now()-started,memory:process.memoryUsage(),hooks,
  sourceHashes:Object.fromEntries(Object.entries(originals).map(([k,v])=>[k,sha(v)]))};
runtime.close();
for(const [name,data] of Object.entries({'ticks.json':ticks,'states.json':states,'source-inputs.json':originals}))await writeFile(join(out,name+'.gz'),gzipSync(JSON.stringify(data)));
await writeFile(join(out,'command-frames.jsonl.gz'),gzipSync(commands.join('')));
await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));
await writeFile(join(out,'probe-source.mjs'),await readFile(new URL(import.meta.url)));
await writeFile(join(out,'room.json'),JSON.stringify(roomInput,null,2));
console.log(JSON.stringify({mode,finalChecksum:summary.finalChecksum,elapsedMs:summary.elapsedMs}));
