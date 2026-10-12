/** Real simulation + production WorldPresentation (GPU actors, Canvas ground/HUD). */
import {createBuilding} from '../src/shared/map';
import {createShipWebglScene} from '../src/recorder/scenes/ship-webgl';
import type {World3DLayer} from '../src/client/world3d/world-layer';
import type * as THREE from 'three';
import {createGame,issueCommand,snapshotGame,stepGame,strikeUnit} from '../src/shared/sim';
import {WorldPresentation} from '../src/client/world-presentation';
import {CombatPresentationTracker} from '../src/client/combat-presentation';
import {UnitAnimationTracker} from '../src/client/unit-animation';
import {UnitFacingTracker} from '../src/client/unit-facing';
import {UnitMotionSmoother} from '../src/client/unit-motion';
import type {WorldFrame} from '../src/client/world-renderer';

export async function combatEffectsProof(){
 const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
 game.units=[];game.buildings=[];game.resources=[];game.obstacles=[];game.items=[];game.mercenaryCamps=[];game.shops=[];
 game.buildings.push(createBuilding('ink-tower','enemy','defenseTower',1040,640,true),createBuilding('ink-barracks','enemy','barracks',1110,650,true),createBuilding('ink-farm','enemy','farm',1000,730,true));
 const hidden=game.spawnUnit('enemy','priest',1040,599);hidden.hp=55;hidden.order={type:'hold',x:hidden.x,y:hidden.y};
 const knight=game.spawnUnit('player','knight',520,610),foe=game.spawnUnit('enemy','footman',710,490);
 issueCommand(game,{type:'setAutocast',unitIds:[knight.id],ability:'charge',enabled:false});
 const fighter=game.spawnUnit('player','footman',830,660),victim=game.spawnUnit('enemy','priest',865,660);
 const worker=game.spawnUnit('player','worker',1020,510),machine=game.spawnUnit('enemy','golem',1055,510);
 victim.hp=55;machine.hp=55;
 const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;document.body.append(canvas);
 const presentation=new WorldPresentation(canvas),combat=new CombatPresentationTracker();
 const ctx=canvas.getContext('2d')!,composite=document.createElement('canvas');composite.width=960;composite.height=540;const out=composite.getContext('2d')!;
 const frame:WorldFrame={ctx,snapshot:snapshotGame(game),view:{x:440,y:350,width:960,height:540,zoom:1.35},now:0,facing:new UnitFacingTracker(),motion:new UnitMotionSmoother(),animation:new UnitAnimationTracker(),combat,labels:{mercenaryStock:n=>String(n),unitKind:k=>k},viewer:'player',still:true};
 await presentation.prepare(frame.snapshot,'home');
 const frames:string[]=[],report:{tick:number;droplets:number;ground:number;body:number;speedLines:number}[]=[];
 let mechanicalBlood=false,hadWebGL=false;
 let occlusion:ReturnType<typeof bodyOcclusionProbe>|undefined;
 for(let index=0;index<48;index++){
  if(index===1)issueCommand(game,{type:'cast',unitId:knight.id,ability:'charge',targetId:foe.id});
  if(index===4){strikeUnit(game,fighter,victim,38,'melee');strikeUnit(game,worker,machine,38,'melee');strikeUnit(game,fighter,hidden,38,'melee');}
  if(index===10&&victim.hp>0)strikeUnit(game,fighter,victim,200,'melee');
  if(index===14)issueCommand(game,{type:'move',unitIds:[fighter.id],x:950,y:715});
  for(let tick=0;tick<2;tick++)stepGame(game);
  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;presentation.draw(frame,'home');
  const accents=combat.frame(frame.now);mechanicalBlood ||= accents.body.some(mark=>mark.unitId===machine.id);
  if(index===5)occlusion=bodyOcclusionProbe(presentation,frame,accents,hidden.id);
  report.push({tick:game.tick,droplets:accents.droplets.length,ground:accents.ground.length,body:accents.body.length,speedLines:accents.speedLines.length});
  const ground=document.querySelector<HTMLCanvasElement>('.world-ground'),actors=document.querySelector<HTMLCanvasElement>('.world-actors');
  hadWebGL ||= Boolean(actors&&!actors.parentElement?.hidden);
  out.clearRect(0,0,960,540);if(ground&&!ground.parentElement?.hidden)out.drawImage(ground,0,0,960,540);if(actors&&!actors.parentElement?.hidden)out.drawImage(actors,0,0,960,540);out.drawImage(canvas,0,0);
  out.fillStyle='#efe5ce';out.fillRect(0,0,960,34);out.fillStyle='#342c28';out.font='14px sans-serif';out.fillText(`Real combat · WebGL actors + shared ink layers · tick ${game.tick} · drops ${accents.droplets.length} / ground ${accents.ground.length} / speed ${accents.speedLines.length}`,14,22);
  frames.push(composite.toDataURL('image/png'));await new Promise(requestAnimationFrame);
 }
 const layer=(presentation as unknown as {layer:World3DLayer}).layer;
 const combatStats=layer.combatStats();
 const programs=((layer as unknown as {renderer:THREE.WebGLRenderer}).renderer.info.programs??[]).map(program=>({name:program.name,runnable:program.diagnostics?.runnable??true}));
 const gl= document.querySelector<HTMLCanvasElement>('.world-actors')?.getContext('webgl2');const glError=gl?.getError()??-1;
 presentation.dispose();canvas.remove();combat.reset();
 const deck=await deckProof();frames.push(...deck.frames);delete (deck as {frames?:string[]}).frames;
 return {frames,report,deck,occlusion,combatStats,programs,mechanicalBlood,hadWebGL,glError,passed:occlusion?.passed===true&&deck.passed&&programs.every(p=>p.runnable)&&hadWebGL&&!mechanicalBlood&&glError===0&&report.some(f=>f.droplets>0)&&report.some(f=>f.ground>0)&&report.some(f=>f.body>0)&&report.some(f=>f.speedLines>0),method:'48 land/building frames and 32 deck frames at two real simulation ticks each (8 simulation seconds). Production WorldPresentation, live damage and charge commands; no synthetic visual events.'};
}
async function deckProof(){
 const {game,ship}=createShipWebglScene();
 const crew=game.units.find(unit=>unit.deck&&unit.kind==='footman')!;crew.hp=55;
 const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;document.body.append(canvas);const presentation=new WorldPresentation(canvas),combat=new CombatPresentationTracker();
 const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:snapshotGame(game),view:{x:660,y:620,width:960,height:540,zoom:1.3},now:0,facing:new UnitFacingTracker(),animation:new UnitAnimationTracker(),combat,selectedIds:new Set([ship.id]),labels:{mercenaryStock:()=>'',unitKind:k=>k},still:true};
 await presentation.prepare(frame.snapshot,'home');
 const composite=document.createElement('canvas');composite.width=960;composite.height=540;const out=composite.getContext('2d')!,frames:string[]=[],samples=[];
 for(let index=0;index<32;index++){
  if(index===2)strikeUnit(game,{id:'shore-bow',owner:'enemy',x:ship.x+200,y:ship.y},crew,38,'ranged');
  if(index===23)ship.hp=0;
  for(let step=0;step<2;step++)stepGame(game);
  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;presentation.draw(frame,'home');
  const ink=combat.frame(frame.now);const layer=(presentation as unknown as {layer:World3DLayer}).layer;
  samples.push({tick:game.tick,...layer.combatStats(),elevated:ink.ground.filter(mark=>mark.height>0).length,shipAlive:game.units.some(unit=>unit.id===ship.id&&unit.hp>0)});
  out.clearRect(0,0,960,540);for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,960,540);out.drawImage(canvas,0,0);
  out.fillStyle='#efe5ce';out.fillRect(0,0,960,32);out.fillStyle='#342c28';out.font='14px sans-serif';out.fillText(`Real deck hit / hull depth / sinking cleanup · tick ${game.tick} · elevated stains ${ink.ground.filter(p=>p.height>0).length}`,14,22);frames.push(composite.toDataURL('image/png'));
  await new Promise(requestAnimationFrame);
 }
 const glError=document.querySelector<HTMLCanvasElement>('.world-actors')?.getContext('webgl2')?.getError()??-1;
 const passed=glError===0&&samples.some(sample=>sample.deck>0)&&samples.some(sample=>sample.body>0)&&samples.filter(sample=>!sample.shipAlive).every(sample=>sample.deck===0&&sample.air===0);
 presentation.dispose();canvas.remove();return{frames,samples,glError,passed};
}
/** Only the proof toggles depth for a negative control: production always tests
 * depth. Identical frame/matrices show whether a building actually hides ink. */
function bodyOcclusionProbe(presentation:WorldPresentation,frame:WorldFrame,accents:ReturnType<CombatPresentationTracker['frame']>,unitId:string){
 const mark=accents.body.find(mark=>mark.unitId===unitId),at=presentation.position(unitId);
 if(!mark||!at)return{passed:false,reason:'No live marked target'};
 const layer=(presentation as unknown as {layer:World3DLayer}).layer;
 const internals=layer as unknown as {renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.Camera};
 const mesh=internals.scene.getObjectByName('CombatInk') as THREE.InstancedMesh,material=mesh.material as THREE.ShaderMaterial;
 const zoom=frame.view.zoom??1;const unit=frame.snapshot.units.find(unit=>unit.id===unitId)!;
 const point={x:(at.x+mark.localX*(at.facing??1)-frame.view.x)*zoom,y:(at.y+mark.localY-frame.view.y)*zoom};
 const holder=document.createElement('canvas');holder.width=960;holder.height=540;const brush=holder.getContext('2d')!;
 const pixels=()=>{internals.renderer.render(internals.scene,internals.camera);brush.clearRect(0,0,960,540);brush.drawImage(internals.renderer.domElement,0,0);return brush.getImageData(Math.floor(point.x)-6,Math.floor(point.y)-6,12,12).data;};
 const enabled=pixels();mesh.visible=false;const absent=pixels();mesh.visible=true;material.depthTest=false;const bypassed=pixels();material.depthTest=true;internals.renderer.render(internals.scene,internals.camera);
 const difference=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>{let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])changed++;return changed;};
 const testedPixels=difference(enabled,absent),bypassPixels=difference(bypassed,absent),front=presentation.pick(point)?.id;
 return{point,front,testedPixels,bypassPixels,passed:front?.startsWith('ink-')===true&&testedPixels===0&&bypassPixels>0};
}
Object.assign(window,{combatEffectsProof});
