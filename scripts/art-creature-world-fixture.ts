/** Real commands, simulation ticks, animation tracking and production WebGL. */
import {creatures} from '../src/client/art/appearance';
import {createGame,issueCommand,snapshotGame,stepGame} from '../src/shared/sim';
import {WorldPresentation} from '../src/client/world-presentation';
import {UnitAnimationTracker} from '../src/client/unit-animation';
import {UnitFacingTracker} from '../src/client/unit-facing';
import type {WorldFrame} from '../src/client/world-renderer';
import type {World3DLayer} from '../src/client/world3d/world-layer';
import type {UnitKind} from '../src/shared/types';
export async function combatEffectsProof(){
 const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
 game.units=[];game.buildings=[];game.resources=[];game.obstacles=[];game.items=[];game.mercenaryCamps=[];game.shops=[];
 const kinds=Object.keys(creatures) as UnitKind[],pairs=kinds.map((kind,i)=>{
  const x=480+i%7*145,y=480+Math.floor(i/7)*210;
  const unit=game.spawnUnit('player',kind,x,y),target=game.spawnUnit('enemy','footman',x+58,y+[-34,0,34][i%3]!);
  unit.order={type:'hold',x:unit.x,y:unit.y};target.order={type:'hold',x:target.x,y:target.y};return{unit,target};
 });
 const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=860;document.body.append(canvas);
 const presentation=new WorldPresentation(canvas),animation=new UnitAnimationTracker();
 const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:snapshotGame(game),view:{x:330,y:260,width:1280,height:860,zoom:1.05},now:0,facing:new UnitFacingTracker(),animation,labels:{mercenaryStock:()=>'',unitKind:k=>k},viewer:'player'};
 const preparationStart=performance.now();await presentation.prepare(frame.snapshot,'home');const prepareMs=performance.now()-preparationStart;
 const timings:{simulationMs:number;renderSubmitMs:number;renderCompleteMs:number;frameMs:number}[]=[];
 const composite=document.createElement('canvas');composite.width=1280;composite.height=860;const out=composite.getContext('2d')!,frames:string[]=[],actions=new Map<string,Set<string>>();
 for(let i=0;i<80;i++){
  if(i===8)for(const {unit,target}of pairs)issueCommand(game,{type:'attack',unitIds:[unit.id],targetId:target.id});
  const start=performance.now();for(let t=0;t<2;t++)stepGame(game);
  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;const simulated=performance.now();presentation.draw(frame,'home');const submitted=performance.now();
  document.querySelector<HTMLCanvasElement>('.world-actors')?.getContext('webgl2')?.finish();const completed=performance.now();
  timings.push({simulationMs:simulated-start,renderSubmitMs:submitted-simulated,renderCompleteMs:completed-simulated,frameMs:completed-start});
  for(const {unit}of pairs){let seen=actions.get(unit.kind);if(!seen)actions.set(unit.kind,seen=new Set());seen.add(animation.frame(unit,frame.now).mode);}
  out.clearRect(0,0,1280,860);
  for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,1280,860);
  out.drawImage(canvas,0,0);out.fillStyle='#e5ddc7';out.fillRect(0,0,1280,36);out.fillStyle='#343b36';out.font='16px sans-serif';out.fillText(`Creature roster / actual simulation + production renderer / tick ${game.tick}`,18,24);
  frames.push(composite.toDataURL('image/png'));await new Promise(requestAnimationFrame);
 }
 const glError=document.querySelector<HTMLCanvasElement>('.world-actors')?.getContext('webgl2')?.getError()??-1;
 const cardStats=(presentation as unknown as {layer:World3DLayer}).layer.cardStats();
 const distributions=Object.fromEntries((['simulationMs','renderSubmitMs','renderCompleteMs','frameMs'] as const).map(key=>{const values=timings.map(t=>t[key]).sort((a,b)=>a-b);return[key,{mean:values.reduce((a,b)=>a+b,0)/values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],max:values.at(-1),over50ms:values.filter(v=>v>50).length}];}));
 presentation.dispose();canvas.remove();return{frames,kinds,prepareMs,timings,distributions,cardStats,measurement:'Same 80 frames at fixed viewport. Frame includes two simulation ticks, snapshot, renderer submission and gl.finish; excludes capture, PNG encoding and rAF. Software SwiftShader, not hardware GPU FPS.',actions:Object.fromEntries([...actions].map(([k,v])=>[k,[...v]])),glError,passed:glError===0,method:'21 catalog creatures, real attack commands against paired soldiers, 160 simulation ticks. Attack/idle/walk modes are observed, not forced. Cast coverage is reviewed separately in painter sheets.'};
}
Object.assign(window,{combatEffectsProof});
