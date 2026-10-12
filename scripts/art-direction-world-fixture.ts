/** Stationary combat with actual simulation releases, including hold counterattacks. */
import {waitForArtGpuCompletion} from './art-gpu-completion.mjs';
import {createGame,snapshotGame,stepGame} from '../src/shared/sim';
import {WorldPresentation} from '../src/client/world-presentation';
import {UnitAnimationTracker} from '../src/client/unit-animation';
import {UnitFacingTracker} from '../src/client/unit-facing';
import {projectActionFrame} from '../src/client/art/action-direction';
import type {WorldFrame} from '../src/client/world-renderer';
export async function combatEffectsProof(){
 const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
 game.units=[];game.buildings=[];game.resources=[];game.obstacles=[];game.items=[];game.mercenaryCamps=[];game.shops=[];
 const cases=Array.from({length:8},(_,i)=>{
  const counter=i>=6,row=counter?2:Math.floor(i/3),col=counter?i-6:i%3,side=i<3?1:-1,angle=counter?0:[-Math.PI/3,0,Math.PI/3][col]!;
  const x=500+col*260,y=520+row*180;
  const actor=game.spawnUnit('player',counter?'footman':'lancer',x,y);
  const target=game.spawnUnit('enemy','footman',x+side*Math.cos(angle)*(counter?40:68),y+Math.sin(angle)*(counter?40:68));
  actor.order={type:'hold',x,y};target.order={type:'hold',x:target.x,y:target.y};
  return{actor,target,side,aim:counter?0:[-4,0,4][col]!,label:counter?'Hold / counterattack left':`${side===1?'Right':'Left'} / ${['up 60','level','down 60'][col]}`,samples:[] as {tick:number;mode:string;frame:number;side:number;aim:number;direction?:Readonly<{x:number;y:number;height?:number}>}[]};
 });
 const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=960;document.body.append(canvas);
 const presentation=new WorldPresentation(canvas),animation=new UnitAnimationTracker();
 const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:snapshotGame(game),view:{x:380,y:380,width:1280,height:960,zoom:1.5},now:0,facing:new UnitFacingTracker(),animation,labels:{mercenaryStock:()=>'',unitKind:k=>k},viewer:'player'};
 const getContext=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type:string,options?:Record<string,unknown>){return getContext.call(this,type,type==='webgl2'?{...options,preserveDrawingBuffer:true}:options);} as typeof getContext;
 try{await presentation.prepare(frame.snapshot,'home');}finally{HTMLCanvasElement.prototype.getContext=getContext;}
 const gl=document.querySelector<HTMLCanvasElement>('.world-actors')!.getContext('webgl2')!;
 if(!gl.getContextAttributes()?.preserveDrawingBuffer)throw new Error('Capture needs a preserved buffer');
 const composite=document.createElement('canvas');composite.width=1280;composite.height=960;const out=composite.getContext('2d')!,frames:string[]=[];
 for(let i=0;i<80;i++){
  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;presentation.draw(frame,'home');await waitForArtGpuCompletion(gl);
  out.clearRect(0,0,1280,960);for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,1280,960);out.drawImage(canvas,0,0);
  out.fillStyle='#e5ddc7';out.fillRect(0,0,1280,40);out.fillStyle='#343b36';out.font='18px sans-serif';out.fillText(`Actual simulation + production WebGL / tick ${game.tick} / 20 fps`,18,27);
  for(const c of cases){
   const raw=animation.frame(c.actor,frame.now),side=presentation.position(c.actor.id)?.facing??1,pose=projectActionFrame(raw,side);
   c.samples.push({tick:game.tick,mode:raw.mode,frame:raw.frame,side,aim:pose.aim??0,...(raw.direction?{direction:raw.direction}:{})});
   const x=(c.actor.x-frame.view.x)*1.5,y=(c.actor.y-frame.view.y)*1.5;
   out.fillStyle='#e5ddc7ee';out.fillRect(x-115,y+45,255,45);out.fillStyle='#343b36';out.font='15px sans-serif';out.fillText(c.label,x-106,y+62);out.fillText(`${raw.mode} ${raw.frame} / facing ${side} / aim ${pose.aim??0}`,x-106,y+82);
  }
  frames.push(composite.toDataURL('image/png'));stepGame(game);
 }
 const report=cases.map(c=>{const first=c.samples.find(s=>s.mode==='attack');return{label:c.label,expectedSide:c.side,expectedAim:c.aim,actorId:c.actor.id,targetId:c.target.id,samples:c.samples,
  contactSeen:c.samples.some(s=>s.mode==='attack'&&s.frame===0&&s.aim===c.aim),wrongSideAfterFirstRelease:c.samples.filter(s=>first&&s.tick>=first.tick&&s.side!==c.side).length};});
 const glError=gl.getError();presentation.dispose();canvas.remove();
 return{frames,fps:20,cases:report,glError,passed:glError===0&&report.every(c=>c.contactSeen&&c.wrongSideAfterFirstRelease===0),method:'Eight independent hold-position duels. Six lancers target +/-60 and level in both facings; two swordsmen counterattack left. 80 real simulation ticks sampled every tick. No stats or hit timings changed. A failure is expected when run against the pre-fix facing tracker.'};
}
Object.assign(window,{combatEffectsProof});
