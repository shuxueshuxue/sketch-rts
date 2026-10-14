/** Fixed real simulation commands rendered through the production world. */
import {waitForArtGpuCompletion} from '/@fs/workspace/sketch-rts-viewport/scripts/art-gpu-completion.mjs';
import {createGame,issuePlayerCommand,snapshotGame,stepGame} from '/@fs/tmp/sketch-creature-review-before-de3/src/shared/sim.ts';
import {checksumGame} from '/@fs/tmp/sketch-creature-review-before-de3/src/shared/sim/checksum.ts';
import {WorldPresentation} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/world-presentation.ts';
import {UnitAnimationTracker} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/unit-animation.ts';
import {UnitFacingTracker} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/unit-facing.ts';
import {ProjectileOriginTracker} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/projectile-origins.ts';
import {drawAtlasUnitPortrait,drawAtlasUnitFigure} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/atlas-art.ts';
import type {WorldFrame} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/world-renderer.ts';
const kinds=['dragonWhelp','redDragon','deepSnapper'] as const,W=1440,H=1000;
const must=(ok:unknown,msg:string)=>{if(!ok)throw Error(msg);};
async function hash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function creatureGameplayProof(){
 const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
 game.units=[];game.buildings=[];game.items=[];game.resources=[];game.mercenaryCamps=[];game.shops=[];
 const actors=kinds.map((kind,i)=>game.spawnUnit('player',kind,580+i*420,700));
 for(const unit of actors)issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[unit.id]});
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;document.body.append(canvas);
 const presentation=new WorldPresentation(canvas),animation=new UnitAnimationTracker();
 const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:snapshotGame(game),view:{x:300,y:330,width:W,height:H,zoom:1},now:0,facing:new UnitFacingTracker(),animation,projectiles:new ProjectileOriginTracker(),labels:{mercenaryStock:()=>'',unitKind:k=>k},viewer:'player',still:true};
 const original=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type:string,options?:Record<string,unknown>){return original.call(this,type,type==='webgl2'?{...options,preserveDrawingBuffer:true}:options);} as typeof original;
 try{await presentation.prepare(frame.snapshot,'home');}finally{HTMLCanvasElement.prototype.getContext=original;}
 must(presentation.is3D,'Production WebGL unavailable');
 const gl=document.querySelector<HTMLCanvasElement>('.world-actors')!.getContext('webgl2')!;
 const composite=document.createElement('canvas');composite.width=W;composite.height=H;const out=composite.getContext('2d')!;
 const portraits=kinds.map(kind=>{const c=document.createElement('canvas');c.width=c.height=112;drawAtlasUnitPortrait(c.getContext('2d')!,kind,0,0,112,'#617d6c');const body=document.createElement('canvas');body.width=112;body.height=150;drawAtlasUnitFigure(body.getContext('2d')!,kind,112,150,'#617d6c');return{kind,png:c.toDataURL(),bodyPng:body.toDataURL(),canvas:c,body};});
 const frames:string[]=[],snapshots:unknown[]=[],snapshotHashes:string[]=[],commands:unknown[]=[],releases:unknown[]=[],poses:unknown[]=[],seen=new Set<string>(),durations:number[]=[];
 let phase='idle';
 for(let capture=0;capture<40;capture++){
  if(capture===4||capture===22){
   phase=capture===4?'upward native attacks':'downward native attacks';
   // Opponents are scenario placements, not forced poses or damage events.
   for(const unit of actors){const up=capture===4,reach=unit.kind==='deepSnapper'?70:150,target=game.spawnUnit('enemy','rockGolem',unit.x+reach*.5,unit.y+(up?-1:1)*reach*.8660254);issuePlayerCommand(game,'enemy',{type:'holdPosition',unitIds:[target.id]});const command={type:'attack' as const,unitIds:[unit.id],targetId:target.id};issuePlayerCommand(game,'player',command);commands.push({tick:game.tick,command});}
  }
  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;const before=checksumGame(game),at=performance.now();presentation.draw(frame,'home');await waitForArtGpuCompletion(gl);durations.push(performance.now()-at);must(before===checksumGame(game),'Rendering changed simulation');must(presentation.is3D,'Unexpected Canvas fallback');
  snapshots.push(frame.snapshot);snapshotHashes.push(await hash(frame.snapshot));
  for(const unit of actors)poses.push({capture,tick:game.tick,id:unit.id,kind:unit.kind,phase,pose:animation.frame(unit,frame.now),position:presentation.position(unit.id)});
  for(const effect of frame.snapshot.effects)if(effect.sourceId&&actors.some(u=>u.id===effect.sourceId)&&effect.actionMode&&!seen.has(effect.id)){seen.add(effect.id);releases.push({...effect,capture,phase});}
  out.clearRect(0,0,W,H);for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,W,H);out.drawImage(canvas,0,0);
  out.fillStyle='#e5ddc7';out.fillRect(0,0,W,62);out.fillRect(0,800,W,200);out.fillStyle='#343b36';out.font='20px sans-serif';out.fillText(`Production world / real commands / ${phase} / tick ${game.tick}`,20,36);
  for(const [i,p]of portraits.entries()){const x=32+i*465;out.drawImage(p.canvas,x,856);out.drawImage(p.body,x+140,835);out.font='19px sans-serif';out.fillText(p.kind,x,830);}
  frames.push(composite.toDataURL());for(let tick=0;tick<2;tick++)stepGame(game);
 }
 const glError=gl.getError();must(glError===0,'GL error');
 const report={frames,portraits:portraits.map(({canvas,body,...p})=>p),fps:10,snapshots,snapshotHashes,commands,releases,poses,glError,completedFrameWallMs:durations,method:'Untimed functional software WebGL validation; frame wall time includes GPU completion and is not a native performance claim.',passed:releases.length>0&&glError===0};
 presentation.dispose();canvas.remove();return report;
}
Object.assign(window,{creatureGameplayProof});
