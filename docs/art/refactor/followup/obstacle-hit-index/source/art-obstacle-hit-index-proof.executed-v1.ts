/** Real Canvas drawWorld parity and local CPU evidence for one indexed lookup.
 * No browser/GPU, simulation timing, total frame-time or FPS claim. */
import {createCanvas} from '@napi-rs/canvas';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createGame,snapshotGame} from '../src/shared/sim';
import {createUnit} from '../src/shared/map';
import type {GameSnapshot,WorldEffect,Obstacle} from '../src/shared/types';
import type {WorldFrame} from '../src/client/world-renderer';

const root=resolve('.'),out=resolve(process.argv[2]??'docs/art/refactor/followup/obstacle-hit-index');
await mkdir(resolve(out,'source'),{recursive:true});
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const before=await readFile(resolve(out,'source/world-renderer.before.ts'),'utf8');
const after=await readFile(resolve(root,'src/client/world-renderer.ts'),'utf8');
const oldLine='const shake = hitFeedbackOffset(painter.snapshot, obstacle);';
const newLine='const shake = hitFeedbackOffset(painter.snapshot, obstacle,painter.viewIndex.hits);';
if(!before.includes(oldLine)||before.replace(oldLine,newLine)!==after)throw new Error('Only the exact obstacle lookup may differ');
await writeFile(resolve(out,'source/world-renderer.after.ts'),after);
async function load(label:string,source:string){
 const path=resolve(out,`${label}.mjs`);
 const result=await build({stdin:{contents:source+'\nexport {setScratchCanvasFactory} from "./art/scratch-canvas";\nexport {PresentationViewIndex} from "./presentation-view";\nexport {UnitFacingTracker} from "./unit-facing";\n',sourcefile:'world-renderer.ts',resolveDir:resolve(root,'src/client'),loader:'ts'},bundle:true,platform:'node',format:'esm',target:'node24',outfile:path,metafile:true,logLevel:'silent'});
 const dependencies:Record<string,string>={};
 for(const name of Object.keys(result.metafile!.inputs).filter(name=>name!=='world-renderer.ts'))dependencies[name]=sha(await readFile(resolve(root,name)));
 await writeFile(resolve(out,`${label}.inputs.json`),JSON.stringify({dependencies,bundleSHA256:sha(await readFile(path))},null,2)+'\n');
 const api=await import(pathToFileURL(path).href);
 api.setScratchCanvasFactory((width:number,height:number)=>createCanvas(width,height));
 return{api,dependencies};
}
const arms={before:await load('before',before),after:await load('after',after)};
if(JSON.stringify(arms.before.dependencies)!==JSON.stringify(arms.after.dependencies))throw new Error('Non-renderer source graph differs');
const game=createGame('bareDuel',{aiPlayers:[]});
game.units=[createUnit('visible-player','player','footman',420,365),createUnit('visible-enemy','enemy','footman',505,365)];
game.buildings=game.buildings.slice(0,1).map(b=>({...b,x:610,y:300,hp:b.maxHp*.7}));
game.resources=[];game.mercenaryCamps=[];game.shops=[];game.items=[];game.projectiles=[];game.corpses=[];
game.map={...game.map,landmarks:[]};delete game.map.terrain;
const obstacle=(id:string,x:number,y:number,kind:Obstacle['kind']='rocks'):Obstacle=>({id,kind,owner:'neutral',x,y,radius:28,hp:55,maxHp:100,along:{x:1,y:0}});
game.obstacles=[obstacle('visible-rocks',240,300),obstacle('visible-gate',350,240,'gate'),...Array.from({length:1000},(_,i)=>obstacle(`offscreen-${i}`,6000+i*50,7000+(i%30)*50))];
const hit=(id:string,unitId:string,damage:number,remaining:number,x=9000,y=9000):WorldEffect=>({id,type:'hit',unitId,x,y,damage,duration:14,remaining});
const filler=Array.from({length:1000},(_,i)=>hit(`remote-hit-${i}`,`unrelated-${i}`,18,10));
const snapshot=snapshotGame(game);
type Counts={findCalls:number;predicateVisits:number;mapGets:number};
function fixture(label:'before'|'after',scene:GameSnapshot,count=false){
 const api=arms[label].api,canvas=createCanvas(800,600),ctx=canvas.getContext('2d'),index=new api.PresentationViewIndex();
 const counts:Counts={findCalls:0,predicateVisits:0,mapGets:0};
 const previousFind=scene.effects.find;
 if(count){
  Object.defineProperty(scene.effects,'find',{configurable:true,value:function(predicate:(e:WorldEffect,index:number,arr:WorldEffect[])=>boolean){counts.findCalls++;return Array.prototype.find.call(this,(e:WorldEffect,i:number,a:WorldEffect[])=>{counts.predicateVisits++;return predicate(e,i,a);});}});
  index.hits.get=function(id:string){counts.mapGets++;return Map.prototype.get.call(this,id);};
 }
 const frame:WorldFrame={ctx:ctx as unknown as CanvasRenderingContext2D,snapshot:scene,view:{x:0,y:0,width:800,height:600},viewIndex:index,now:1000,facing:new api.UnitFacingTracker(),labels:{mercenaryStock:n=>String(n),unitKind:k=>k},viewer:'player',selectedIds:new Set(['visible-player',scene.buildings[0]!.id]),hoveredId:'visible-enemy'};
 const factsBefore=sha(JSON.stringify(scene));api.drawWorld(frame);const factsAfter=sha(JSON.stringify(scene));
 if(factsBefore!==factsAfter)throw new Error('Renderer mutated authoritative facts');
 if(count){Object.defineProperty(scene.effects,'find',{configurable:true,writable:true,value:previousFind});}
 return{canvas,ctx,frame,index,counts,factsSHA256:factsAfter};
}
const rows=[];
for(const duplicateCount of [2,3])for(const remaining of [14,10,6]){
 const first=hit('first-rocks','visible-rocks',15,remaining,240,300),firstGate=hit('first-gate','visible-gate',22,remaining,350,240);
 snapshot.tick++;
 snapshot.effects=[...filler,first,firstGate,...Array.from({length:duplicateCount-1},(_,i)=>hit(`duplicate-rock-${i}`,'visible-rocks',90-i*20,2+i,240,300)),...Array.from({length:duplicateCount-1},(_,i)=>hit(`duplicate-gate-${i}`,'visible-gate',85-i*20,3+i,350,240))];
 const a=fixture('before',snapshot,true),b=fixture('after',snapshot,true);
 if(b.index.hits.get('visible-rocks')!==first||b.index.hits.get('visible-gate')!==firstGate)throw new Error('First duplicate hit changed');
 const pixelsA=a.ctx.getImageData(0,0,800,600).data,pixelsB=b.ctx.getImageData(0,0,800,600).data;
 let changed=0,maxDiff=0;for(let i=0;i<pixelsA.length;i++){const d=Math.abs(pixelsA[i]!-pixelsB[i]!);changed+=Number(d!==0);maxDiff=Math.max(maxDiff,d);}
 if(changed)throw new Error(`Pixel mismatch ${duplicateCount}/${remaining}`);
 const files=[];for(const [label,subject]of [['before',a],['after',b]]as const){const name=`${label}-duplicates${duplicateCount}-remaining${remaining}.png`,bytes=subject.canvas.toBuffer('image/png');await writeFile(resolve(out,name),bytes);files.push({name,sha256:sha(bytes)});}
 rows.push({duplicateCount,remaining,firstIds:['first-rocks','first-gate'],changedChannels:changed,maxChannelDifference:maxDiff,rgbaSHA256:sha(pixelsA),factsSHA256:a.factsSHA256,before:a.counts,after:b.counts,files});
}
// These uninstrumented runs time the whole actual Canvas drawWorld call. Each
// arm owns its cache/context/index. Canvas readback/encoding stays outside.
const timed={before:fixture('before',snapshot),after:fixture('after',snapshot)};
const timings:{label:string;milliseconds:number}[]=[];
for(let i=0;i<50;i++)for(const label of (i%2?['after','before']:['before','after'])as('before'|'after')[]){
 const subject=timed[label];subject.ctx.clearRect(0,0,800,600);
 const start=performance.now();arms[label].api.drawWorld(subject.frame);const milliseconds=performance.now()-start;
 if(i>=10)timings.push({label,milliseconds});
}
function distribution(label:string){const values=timings.filter(v=>v.label===label).map(v=>v.milliseconds).sort((a,b)=>a-b);return{samples:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.min(values.length-1,Math.floor(values.length*.95))],max:values.at(-1)};}
for(const [name,expected]of Object.entries(arms.before.dependencies))if(sha(await readFile(resolve(root,name)))!==expected)throw new Error('Dependency source changed during proof: '+name);
if(sha(await readFile(resolve(root,'src/client/world-renderer.ts')))!==sha(after))throw new Error('Candidate source changed during proof');
const proof={passed:true,method:'Full original and candidate world-renderer modules bundled separately over identical dependency source bytes; real native Napi Canvas drawWorld, exact full RGBA, strict authoritative fact hashes. Local CPU timings exclude observers, image readback and PNG encoding; not browser, GPU, total frame time or FPS.',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:{node:process.version,canvas:'@napi-rs/canvas native Skia'},source:{beforeSHA256:sha(before),afterSHA256:sha(after),scriptSHA256:sha(await readFile(new URL(import.meta.url))),changedExpression:{before:oldLine,after:newLine},dependencyCount:Object.keys(arms.before.dependencies).length},fixture:{visibleObstacles:2,offscreenObstacles:1000,fillerEffects:1000,visibleUnits:2,visibleBuildings:1,selectedUnit:true,selectedBuilding:true,hoveredUnit:true,damagedObstacleAndBuildingHP:true},rows,localRendererCPU:{before:distribution('before'),after:distribution('after'),samples:timings}};
await writeFile(resolve(out,'proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({out:relative(root,out),passed:true,rows:rows.length,before:rows[0]!.before,after:rows[0]!.after,localRendererCPU:{before:distribution('before'),after:distribution('after')}}));
