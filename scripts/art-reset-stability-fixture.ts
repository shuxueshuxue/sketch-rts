/** Narrow fixed-scene prepare/reset control; no forced GC or global cache clears. */
import {createGame,snapshotGame} from '../src/shared/sim';
import {createBuilding} from '../src/shared/map';
import {WorldPresentation} from '../src/client/world-presentation';
import {UnitFacingTracker} from '../src/client/unit-facing';
import {UnitAnimationTracker} from '../src/client/unit-animation';
import {resources} from '../src/client/resources';
import {worldModels} from '../src/client/world3d/model-library';
import type {WorldFrame} from '../src/client/world-renderer';

const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const resourceKinds=['Texture','Buffer','VertexArray','Framebuffer','Renderbuffer','Program','Shader','Sampler','Sync'] as const;
type Counter={created:number;deleted:number;live:number;highwater:number};
const counts=Object.fromEntries(resourceKinds.map(kind=>[kind,{created:0,deleted:0,live:0,highwater:0}])) as Record<typeof resourceKinds[number],Counter>;
const installed=new WeakSet<WebGL2RenderingContext>();let contexts=0;
function instrument(gl:WebGL2RenderingContext){
 if(installed.has(gl))return;installed.add(gl);contexts++;
 for(const kind of resourceKinds){
  // Weak membership never keeps a GL handle alive; successful public deletion
  // removes membership. Counters report explicit API lifetime, not driver RSS.
  const live=new WeakSet<object>(),counter=counts[kind];
  const createName=kind==='Sync'?'fenceSync':`create${kind}`,deleteName=`delete${kind}`;
  const api=gl as unknown as Record<string,(...args:any[])=>any>;
  const create=api[createName]!,remove=api[deleteName]!;
  api[createName]=function(...args:any[]){const handle=create.apply(gl,args);if(handle&&typeof handle==='object'&&!live.has(handle)){live.add(handle);counter.created++;counter.live++;counter.highwater=Math.max(counter.highwater,counter.live);}return handle;};
  api[deleteName]=function(...args:any[]){const result=remove.apply(gl,args),handle=args[0];if(handle&&typeof handle==='object'&&live.delete(handle)){counter.deleted++;counter.live--;}return result;};
 }
}
const originalGetContext=HTMLCanvasElement.prototype.getContext;
// Installed before WorldPresentation obtains its context, including renderer
// constructor allocations and Three's default textures.
HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:any[]){
 const context=(originalGetContext as Function).apply(this,args);
 if(args[0]==='webgl2'&&context)instrument(context as WebGL2RenderingContext);
 return context;
} as typeof originalGetContext;

let presentation:WorldPresentation|undefined,canvas:HTMLCanvasElement|undefined,frame:WorldFrame|undefined;
let running=false,stopped=false,failure='',stage='loading',started=0,frames=0,prepares=0,disposes=0;
let lastDuration=0,maxDuration=0,releaseRecord:unknown=null;
function state(){
 const layer=(presentation as any)?.layer,renderer=layer?.renderer;
 return{elapsedMs:started?performance.now()-started:0,stage,running,stopped,failure,frames,prepares,disposes,lastDuration,maxDuration,releaseRecord,
  is3D:presentation?.is3D??false,cards:layer?.cardStats(),remains:layer?.remainsStats(),resources:resources.cacheStats(),models:worldModels.cacheStats(),
  renderer:renderer?{memory:{...renderer.info.memory},programs:renderer.info.programs?.length,render:{...renderer.info.render}}:null,
  sceneObjects:layer?.scene.children.length,domCanvases:document.querySelectorAll('canvas').length,glError:renderer?.getContext().getError()??0,
  glCounts:Object.fromEntries(resourceKinds.map(kind=>[kind,{...counts[kind]}])),contexts,
  method:'Fixed snapshot, normal quality. First total-120 seconds prepare every 15 seconds and draw; then 60 seconds retain renderer without drawing; then dispose and 60 seconds idle. GL live is the explicit create-delete difference, not actual driver-live objects; context destruction may reclaim objects without public delete calls. Shared model cache retained.'};
}
async function run(seconds=420){
 if(running||started)throw Error('Fixture permits one run per page');
 running=true;started=performance.now();const activeSeconds=Math.max(0,seconds-120);
 try{
  await resources.initialize();
  const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
  for(const key of ['units','items','buildings','resources','mercenaryCamps','shops','obstacles','effects','projectiles'] as const)(game[key] as unknown[])=[];
  for(let i=0;i<25;i++)game.spawnUnit('player',i%2?'archer':'footman',780+(i%5)*45,650+Math.floor(i/5)*45);
  game.buildings.push(createBuilding('reset-barracks','player','barracks',1120,710,true),createBuilding('reset-tower','player','defenseTower',1120,890,true));
  canvas=document.createElement('canvas');canvas.width=960;canvas.height=640;document.body.append(canvas);presentation=new WorldPresentation(canvas);
  const snapshot=snapshotGame(game);
  frame={ctx:canvas.getContext('2d')!,snapshot,view:{x:650,y:500,width:960,height:640,zoom:1.2},now:0,facing:new UnitFacingTracker(),animation:new UnitAnimationTracker(),labels:{mercenaryStock:()=>'',unitKind:k=>k},still:true};
  const activeStart=performance.now();let nextPrepare=0;
  while(!stopped&&performance.now()-activeStart<activeSeconds*1000){
   const elapsed=performance.now()-activeStart;
   if(elapsed>=nextPrepare){stage='prepare';await presentation.prepare(snapshot,'match');prepares++;nextPrepare+=15000;}
   stage='draw';const at=performance.now();presentation.draw(frame,'match');frames++;
   if(!presentation.is3D)throw Error('Unexpected Canvas fallback');
   lastDuration=performance.now()-at;maxDuration=Math.max(maxDuration,lastDuration);
   await sleep(Math.max(100,150-lastDuration));
  }
  stage='retained-idle';const idleStart=performance.now();while(!stopped&&performance.now()-idleStart<60000)await sleep(250);
  stage='dispose';{const old=(presentation as any)?.layer;presentation.dispose();disposes++;
   releaseRecord={cards:old?.cardStats(),remains:old?.remainsStats(),sceneObjects:old?.scene.children.length};}
  canvas.remove();canvas=undefined;presentation=undefined;frame=undefined;
  stage='disposed-idle';const disposedStart=performance.now();while(!stopped&&performance.now()-disposedStart<60000)await sleep(250);
  stage='complete';
 }catch(error){failure=String((error as Error).stack??error);stage='failed';}
 finally{running=false;stopped=true;HTMLCanvasElement.prototype.getContext=originalGetContext;}
 return state();
}
Object.assign(window,{artStability:{run,state,stop:()=>{stopped=true;}}});
