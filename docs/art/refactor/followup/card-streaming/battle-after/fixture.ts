/** Production render, actual simulation combat and an explicitly scripted real hit. */
import {waitForArtGpuCompletion} from '/@fs/workspace/sketch-rts-viewport/scripts/art-gpu-completion.mjs';
import {createGame,snapshotGame,stepGame,strikeUnit,issueCommand} from '/@fs/workspace/sketch-rts-viewport/src/shared/sim.ts';
import {WorldPresentation} from '/@fs/workspace/sketch-rts-viewport/src/client/world-presentation.ts';
import {UnitAnimationTracker} from '/@fs/workspace/sketch-rts-viewport/src/client/unit-animation.ts';
import {UnitFacingTracker} from '/@fs/workspace/sketch-rts-viewport/src/client/unit-facing.ts';
import {CombatPresentationTracker} from '/@fs/workspace/sketch-rts-viewport/src/client/combat-presentation.ts';
import {projectActionFrame} from '/@fs/workspace/sketch-rts-viewport/src/client/art/action-direction.ts';
import type {WorldFrame} from '/@fs/workspace/sketch-rts-viewport/src/client/world-renderer.ts';
export async function combatEffectsProof(){
 const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
 game.units=[];game.buildings=[];game.resources=[];game.obstacles=[];game.items=[];game.mercenaryCamps=[];game.shops=[];
 const guards=Array.from({length:4},(_,i)=>{
  const side=i<2?1:-1,aim=i%2===0?-4:4,x=470+i*240,y=535;
  const actor=game.spawnUnit('player','lancer',x,y),victim=game.spawnUnit('enemy','footman',x+side*34,y+Math.sign(aim)*58.89);
  actor.order={type:'hold',x,y};victim.order={type:'hold',x:victim.x,y:victim.y};victim.hp=1;
  return{actor,side,aim,walk:i%2===1,label:`${side>0?'Right':'Left'} / ${aim<0?'up':'down'} / ${i%2?'retreat':'idle'}`,samples:[] as object[]};
 });
 const sword=game.spawnUnit('player','lancer',520,825),wound=game.spawnUnit('enemy','footman',567,825),other=game.spawnUnit('player','footman',594,825);wound.hp=35;
 const heavy=game.spawnUnit('player','footman',930,825),victim=game.spawnUnit('enemy','footman',980,825),bystander=game.spawnUnit('enemy','footman',1014,839);victim.hp=90;
 for(const unit of [sword,wound,other,heavy,victim,bystander])unit.order={type:'hold',x:unit.x,y:unit.y};
 const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=900;document.body.append(canvas);
 const presentation=new WorldPresentation(canvas),animation=new UnitAnimationTracker(),combat=new CombatPresentationTracker();
 const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:snapshotGame(game),view:{x:340,y:340,width:1280,height:900,zoom:1.15},now:0,facing:new UnitFacingTracker(),animation,combat,labels:{mercenaryStock:()=>'',unitKind:k=>k},viewer:'player'};
 const getContext=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type:string,options?:Record<string,unknown>){return getContext.call(this,type,type==='webgl2'?{...options,preserveDrawingBuffer:true}:options);} as typeof getContext;
 try{await presentation.prepare(frame.snapshot,'home');}finally{HTMLCanvasElement.prototype.getContext=getContext;}
 const gl=document.querySelector<HTMLCanvasElement>('.world-actors')!.getContext('webgl2')!;
 const composite=document.createElement('canvas');composite.width=1280;composite.height=900;const out=composite.getContext('2d')!,frames:string[]=[],samples:object[]=[];
 const simSnapshotHashes:string[]=[],viewportProbes:object[]=[];
 const factHash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const rawComposite=()=>{const c=document.createElement('canvas');c.width=1280;c.height=900;const b=c.getContext('2d')!;for(const layer of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!layer.parentElement?.hidden)b.drawImage(layer,0,0,1280,900);b.drawImage(canvas,0,0);return c.toDataURL('image/png');};
 let bodyTransfer=false,weaponTransfer=false,walkGuard=false,expired=false,holdGuard=false,wrongFacing=0;
 const renderTimes:number[]=[];
 for(let i=0;i<80;i++){
  if(i===10){strikeUnit(game,heavy,victim,75,'melee');issueCommand(game,{type:'move',unitIds:[heavy.id],x:850,y:850});}
  if(i===13)for(const c of guards)if(c.walk)issueCommand(game,{type:'move',unitIds:[c.actor.id],x:c.actor.x-c.side*90,y:c.actor.y+50});
  if(i===28)issueCommand(game,{type:'move',unitIds:[other.id],x:680,y:870});
  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;simSnapshotHashes.push(await factHash(frame.snapshot));
  const start=performance.now();presentation.draw(frame,'home');const submitted=performance.now();renderTimes.push(submitted-start);
  await waitForArtGpuCompletion(gl);
  if(i===1){
   const originalView=frame.view,originalPng=rawComposite(),trackerDrops=combat.frame(frame.now).droplets.length;
   const layer=(presentation as unknown as {layer:{combatStats:()=>unknown}}).layer;
   const battlefieldInk=layer.combatStats();
   frame.view={...originalView,x:24000,y:24000};presentation.draw(frame,'home');await waitForArtGpuCompletion(gl);
   const emptyInk=layer.combatStats(),emptyPng=rawComposite(),emptyTrackerDrops=combat.frame(frame.now).droplets.length;
   frame.view=originalView;presentation.draw(frame,'home');await waitForArtGpuCompletion(gl);
   viewportProbes.push({frame:i,tick:game.tick,now:frame.now,trackerDrops,emptyTrackerDrops,battlefieldInk,emptyInk,returnedInk:layer.combatStats(),originalPng,emptyPng,returnedPng:rawComposite(),simHashBefore:simSnapshotHashes.at(-1),simHashAfter:await factHash(snapshotGame(game)),scope:'Same simulation tick, snapshot and clock. Probe performs two extra presentation draws and zero simulation steps. Starts while the first real lethal-hit drops are airborne.'});
  }
  out.clearRect(0,0,1280,900);for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,1280,900);out.drawImage(canvas,0,0);
  out.fillStyle='#e5ddc7';out.fillRect(0,0,1280,44);out.fillStyle='#343b36';out.font='18px sans-serif';out.fillText(`3-second weapon guard + blood transfer / simulation tick ${game.tick} / 10 fps`,18,29);
  for(const c of guards){
   const raw=animation.frame(c.actor,frame.now),side=presentation.position(c.actor.id)?.facing??1,pose=projectActionFrame(raw,side);
   if(i>8&&raw.carry){if(side!==c.side)wrongFacing++;walkGuard ||= raw.mode==='walk';holdGuard ||=raw.mode==='idle';}
   if(game.tick>85&&!raw.carry)expired=true;
   c.samples.push({tick:game.tick,mode:raw.mode,frame:raw.frame,carry:raw.carry??0,aim:pose.carryAim??0,side});
   const x=(c.actor.x-frame.view.x)*1.15,y=(c.actor.y-frame.view.y)*1.15;
   out.fillStyle='#e5ddc7ee';out.fillRect(x-90,y+42,220,42);out.fillStyle='#343b36';out.font='14px sans-serif';out.fillText(c.label,x-84,y+58);out.fillText(`${raw.mode} / carry ${raw.carry??0}/6 / aim ${pose.carryAim??0}`,x-84,y+77);
  }
  const ink=combat.frame(frame.now),weapon=ink.body.filter(m=>m.surface==='weapon'),neighbor=ink.body.filter(m=>m.unitId===bystander.id&&!m.surface);
  bodyTransfer ||=neighbor.length>0;weaponTransfer ||=weapon.length>0;
  samples.push({tick:game.tick,drops:ink.droplets.length,ground:ink.ground.length,body:ink.body.length,neighbor:neighbor.length,weapon:weapon.map(m=>({unit:m.unitId,x:m.localX,y:m.localY,width:m.width,alpha:m.alpha}))});
  out.fillStyle='#e5ddc7ee';out.fillRect(130,640,330,50);out.fillRect(610,640,460,50);out.fillStyle='#343b36';out.font='16px sans-serif';out.fillText(`Natural melee / weapon stains ${weapon.length}`,145,663);out.fillText(`Scripted real hit (75) / bystander stains ${neighbor.length}`,625,663);
  out.font='14px sans-serif';out.fillText('Stains follow the moving weapon and fade.',145,681);out.fillText('Hit uses real damage effects; no synthetic blood marks.',625,681);
  frames.push(composite.toDataURL('image/png'));stepGame(game);stepGame(game);
 }
 const glError=gl.getError();presentation.dispose();canvas.remove();
 return{frames,fps:10,simSnapshotHashes,viewportProbes,guards:guards.map(c=>({label:c.label,samples:c.samples})),samples,renderSubmitMs:renderTimes,bodyTransfer,weaponTransfer,walkGuard,holdGuard,expired,wrongFacing,glError,passed:bodyTransfer&&weaponTransfer&&walkGuard&&holdGuard&&expired&&wrongFacing===0&&glError===0,method:'160 real ticks. Four lancers kill low-HP targets with normal combat; two then retreat. Natural melee coats nearby weapons. One explicitly scripted strikeUnit(75, melee) exercises a stronger real hit next to a bystander. Combat stats, AI and simulation rules unchanged. 3-second guard starts after recovery; 450ms return. Capture-only preserveDrawingBuffer.'};
}
Object.assign(window,{combatEffectsProof});
