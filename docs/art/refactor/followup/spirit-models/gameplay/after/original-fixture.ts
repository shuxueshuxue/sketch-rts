/** Real summoned spirits, six actual target vectors, production GPU/Canvas and UI. */
import {waitForArtGpuCompletion} from './art-gpu-completion.mjs';
import {createGame,issuePlayerCommand,removeUnit,snapshotGame,stepGame,strikeUnit} from '../src/shared/sim';
import {checksumGame} from '../src/shared/sim/checksum';
import {ABILITY_DEFS,UNIT_DEFS} from '../src/shared/catalog';
import type {Unit} from '../src/shared/types';
import {WorldPresentation} from '../src/client/world-presentation';
import {drawWorld,type WorldFrame} from '../src/client/world-renderer';
import {UnitAnimationTracker} from '../src/client/unit-animation';
import {UnitFacingTracker} from '../src/client/unit-facing';
import {CombatPresentationTracker} from '../src/client/combat-presentation';
import {projectActionFrame} from '../src/client/art/action-direction';
import {appearanceFor,corpseAppearanceFor} from '../src/client/art/unit-appearance';
import {drawAtlasUnitPortrait,drawAtlasUnitFigure,drawAtlasCorpse} from '../src/client/atlas-art';

const WIDTH=1440,HEIGHT=1000,CAPTURES=80;
const color='#6b7f68',assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
async function hash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');}
const image=(canvas:HTMLCanvasElement)=>canvas.toDataURL('image/png');
const createCanvas=(width:number,height:number)=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};

export async function spiritGameplayProof(){
 const game=createGame('bareDuel',{aiPlayers:[],scenario:{replaceDefaultUnits:true,replaceDefaultBuildings:true,replaceDefaultResources:true,replaceDefaultMercenaryCamps:true,replaceDefaultLandmarks:true}});game.scriptedVictory=true;
 assert(UNIT_DEFS.spirit.abilities.length===0,'Spirit has no cast skill: do not fabricate one');
 const lanes=[-1,1].flatMap((facing,row)=>[-1,0,1].map((aim,column)=>({facing,aim,x:530+column*340,y:610+row*260})));
 const commands:object[]=[],summons:object[]=[],actors:Unit[]=[],casters:Unit[]=[],targets=new Map<string,Unit>();
 const run=(owner:'player'|'enemy',command:Parameters<typeof issuePlayerCommand>[2])=>{issuePlayerCommand(game,owner,command);commands.push({tick:game.tick,owner,command});};
 for(const lane of lanes){
  const caster=game.spawnUnit('player','summoner',lane.x,lane.y-120);casters.push(caster);
  run('player',{type:'holdPosition',unitIds:[caster.id]});
  const before=new Set(game.units.map(u=>u.id));run('player',{type:'cast',unitId:caster.id,ability:'summon',x:lane.x,y:lane.y});
  const unit=game.units.find(u=>!before.has(u.id));assert(unit?.kind==='spirit','Actual summon did not produce a spirit');actors.push(unit!);
  assert(unit!.expiresTick===game.tick+ABILITY_DEFS.summon.summonDuration,'Actual summon lifetime changed');
  assert(unit!.hp===UNIT_DEFS.spirit.hp&&unit!.attackDamage===UNIT_DEFS.spirit.attackDamage&&unit!.attackRange===UNIT_DEFS.spirit.attackRange,'Actual summon stats changed');
  summons.push({casterId:caster.id,unitId:unit!.id,tick:game.tick,kind:unit!.kind,x:unit!.x,y:unit!.y,hp:unit!.hp,maxHp:unit!.maxHp,attackDamage:unit!.attackDamage,attackRange:unit!.attackRange,attackCooldown:unit!.attackCooldown,expiresTick:unit!.expiresTick,casterAbilityCooldown:caster.abilityCooldowns?.summon});
  run('player',{type:'holdPosition',unitIds:[unit!.id]});
 }
 const initial=snapshotGame(game),initialSnapshotSha256=await hash(initial);
 const canvas=createCanvas(WIDTH,HEIGHT);document.body.append(canvas);
 const presentation=new WorldPresentation(canvas),animation=new UnitAnimationTracker();
 const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:initial,view:{x:350,y:365,width:WIDTH,height:HEIGHT,zoom:1.3},now:0,facing:new UnitFacingTracker(),animation,combat:new CombatPresentationTracker(),labels:{mercenaryStock:stock=>String(stock),unitKind:k=>k},viewer:'player',selectedIds:new Set(actors.map(u=>u.id))};
 const originalGetContext=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type:string,options?:Record<string,unknown>){return originalGetContext.call(this,type,type==='webgl2'?{...options,preserveDrawingBuffer:true}:options);} as typeof originalGetContext;
 try{await presentation.prepare(frame.snapshot,'home');}finally{HTMLCanvasElement.prototype.getContext=originalGetContext;}
 assert(presentation.is3D,'Evidence requires the production WebGL layer');
 const actorCanvas=document.querySelector<HTMLCanvasElement>('.world-actors')!,gl=actorCanvas.getContext('webgl2')!;
 assert(gl.getContextAttributes()?.preserveDrawingBuffer,'Capture requires a preserved GPU buffer');
 const composite=createCanvas(WIDTH,HEIGHT),out=composite.getContext('2d')!;
 const fallback=createCanvas(WIDTH,HEIGHT),fallbackFrame:WorldFrame={...frame,ctx:fallback.getContext('2d')!,facing:new UnitFacingTracker(),animation:new UnitAnimationTracker(),combat:new CombatPresentationTracker()};
 const portraits=['spirit','summoner','footman'].map(kind=>{
  const k=kind as Unit['kind'],portrait=createCanvas(112,112),body=createCanvas(112,150);
  drawAtlasUnitPortrait(portrait.getContext('2d')!,k,0,0,112,color);drawAtlasUnitFigure(body.getContext('2d')!,k,112,150,color);
  assert(portrait.getContext('2d')!.getImageData(0,0,112,112).data.some((v,i)=>i%4===3&&v>0),`${kind} portrait is empty`);
  return{kind,portrait,body,png:image(portrait),bodyPng:image(body)};
 });
 const frames:string[]=[],canvasFrames:object[]=[],samples:object[]=[],snapshots:object[]=[],snapshotHashes:string[]=[],releaseIds=new Set<string>();
 const releases:object[]=[],picks:object[]=[],drawMutations:object[]=[],actualDeaths:object[]=[],scriptedExits:object[]=[],socketSamples:object[]=[];
 const canvasCaptures=new Set([0,8,23,25,26,27,28,29,30,48,49,50,51,60,68,75,79]);
 for(let capture=0;capture<CAPTURES;capture++){
  if(capture===8){
   // Real scripted exits keep nearby ranged summoners from taking over their
   // spirits' combat. No caster/target stats or combat rule is modified.
   for(const caster of casters){scriptedExits.push({tick:game.tick,id:caster.id,method:'removeUnit scripted exit after actual summon'});removeUnit(game,caster.id);}
   for(const [i,unit]of actors.entries())run('player',{type:'move',unitIds:[unit.id],x:unit.x+lanes[i]!.facing*48,y:unit.y});
  }
  if(capture===24){
   for(const [i,unit]of actors.entries()){
    run('player',{type:'holdPosition',unitIds:[unit.id]});
    const lane=lanes[i]!,dx=lane.facing*(lane.aim?27:54),dy=lane.aim*27*Math.sqrt(3);
    const target=game.spawnUnit('enemy','footman',unit.x+dx,unit.y+dy);targets.set(unit.id,target);
    run('enemy',{type:'holdPosition',unitIds:[target.id]});run('player',{type:'attack',unitIds:[unit.id],targetId:target.id});
   }
  }
  if(capture===60)for(const unit of actors)run('player',{type:'holdPosition',unitIds:[unit.id]});
  if(capture===64)for(const [i,unit]of actors.entries())run('player',{type:'move',unitIds:[unit.id],x:unit.x-lanes[i]!.facing*28,y:unit.y+18});
  if(capture===74){
   for(const unit of actors){
    if(!game.units.includes(unit))continue;
    const attacker=targets.get(unit.id)!;const before={id:unit.id,kind:unit.kind,hp:unit.hp,x:unit.x,y:unit.y};
    strikeUnit(game,attacker,unit,unit.hp+unit.maxHp+100,'melee');stepGame(game);
    const corpse=game.corpses?.find(c=>c.unitId===unit.id);assert(corpse,`Actual lethal strike did not create ${unit.id} remains`);
    actualDeaths.push({tick:game.tick,sourceId:attacker.id,method:'Explicitly scripted strikeUnit through original damage/death rules; no unit stat changes',before,corpse});
   }
  }
  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;const beforeDraw=checksumGame(game);
  const fact={capture,tick:game.tick,snapshot:frame.snapshot};snapshots.push(fact);snapshotHashes.push(await hash(frame.snapshot));
  presentation.draw(frame,'home');await waitForArtGpuCompletion(gl);
  assert(presentation.is3D,`Unexpected fallback at tick ${game.tick}`);
  for(const effect of frame.snapshot.effects){
   if(effect.sourceId&&[...casters,...actors].some(u=>u.id===effect.sourceId)&&effect.actionMode&&!releaseIds.has(effect.id)){
    releaseIds.add(effect.id);releases.push({...effect,capture,observedTick:game.tick});
   }
  }
  for(const [i,unit]of actors.entries()){
   const alive=frame.snapshot.units.find(u=>u.id===unit.id);if(!alive)continue;
   const position=presentation.position(unit.id)!;assert(position,`No real projected position for ${unit.id}`);
   const raw=animation.frame(alive,frame.now),facing=position.facing??1,pose=projectActionFrame(raw,facing);
   const row={capture,tick:game.tick,id:unit.id,lane:lanes[i],hp:unit.hp,targetHp:targets.get(unit.id)?.hp??null,x:unit.x,y:unit.y,facing,mode:pose.mode,frame:pose.frame,variant:pose.variant??0,aim:pose.aim??0,carry:pose.carry??0,carryAim:pose.carryAim??0,rawDirection:raw.direction??null,appearance:appearanceFor(frame.snapshot,alive)};samples.push(row);
   if(pose.mode==='attack'&&pose.frame<5&&raw.direction){
    assert(facing===Math.sign(raw.direction.x),`Release facing flipped for ${unit.id}`);
    assert(Math.sign(pose.aim??0)===lanes[i]!.aim,`Attack up/down disagrees with actual target for ${unit.id}`);
   }
   if(capture===0||capture===23||capture===26||capture===51){
    let picked:ReturnType<WorldPresentation['pick']>,pickedPoint:object|undefined;
    for(const y of [21,28,34,15,40])for(const x of [0,-5,5,-9,9])if(picked?.id!==unit.id){
     const point={x:(position.x-frame.view.x)*frame.view.zoom!+x*frame.view.zoom!,y:(position.bodyY-frame.view.y)*frame.view.zoom!-y*frame.view.zoom!};
     const result=presentation.pick(point);if(result?.id===unit.id){picked=result;pickedPoint=point;}
    }
    picks.push({capture,tick:game.tick,id:unit.id,pickedId:picked?.id??null,matched:picked?.id===unit.id,point:pickedPoint??null});
   }
  }
  if(canvasCaptures.has(capture)){
   fallbackFrame.snapshot=frame.snapshot;fallbackFrame.now=frame.now;
   // Advance all fallback histories on every tick below, so sampled Canvas
   // evidence does not reset locomotion or invent a new release.
   drawWorld(fallbackFrame);canvasFrames.push({capture,tick:game.tick,png:image(fallback)});
  }else{fallbackFrame.snapshot=frame.snapshot;fallbackFrame.now=frame.now;fallbackFrame.animation!.update(frame.snapshot,frame.now);}
  const afterDraw=checksumGame(game);if(beforeDraw!==afterDraw)drawMutations.push({capture,tick:game.tick,beforeDraw,afterDraw});
  out.clearRect(0,0,WIDTH,HEIGHT);for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,WIDTH,HEIGHT);out.drawImage(canvas,0,0);
  out.fillStyle='#e5ddc7f2';out.fillRect(0,0,WIDTH,66);out.fillStyle='#343b36';out.font='21px sans-serif';out.fillText('Summoned shades / actual summon, movement, attacks and deaths',20,28);
  out.font='16px sans-serif';out.fillText(`Tick ${game.tick} / left and right facing / targets at up 60°, horizontal and down 60° / original combat rules`,20,52);
  for(const [i,lane]of lanes.entries()){out.font='16px sans-serif';out.fillText(`${lane.facing<0?'Left':'Right'} / ${lane.aim<0?'up 60°':lane.aim>0?'down 60°':'horizontal'}`,((lane.x-frame.view.x)*frame.view.zoom!)-88,((lane.y-frame.view.y)*frame.view.zoom!)+90);}
  out.fillStyle='#e5ddc7f0';out.fillRect(0,810,WIDTH,190);
  for(const [i,portrait]of portraits.entries()){const x=24+i*440;out.drawImage(portrait.portrait,x,842);out.drawImage(portrait.body,x+130,822);out.fillStyle='#343b36';out.font='18px sans-serif';out.fillText(`${portrait.kind} / real portrait and figure`,x,833);}
  const corpse=frame.snapshot.corpses?.find(c=>c.kind==='spirit');if(corpse){out.save();out.translate(1318,918);out.scale(2.5,2.5);drawAtlasCorpse(out,corpse.kind,{x:0,y:0},1,0,undefined,'',color,corpseAppearanceFor(frame.snapshot,corpse));out.restore();out.font='15px sans-serif';out.fillText('Actual remains',1245,977);}
  frames.push(image(composite));stepGame(game);
 }
 const glError=gl.getError(),debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const seen=actors.map((unit,i)=>{const rows=samples.filter((r:any)=>r.id===unit.id) as {mode:string;frame:number;facing:number;aim:number;variant:number}[];return{id:unit.id,lane:lanes[i],modes:[...new Set(rows.map(r=>r.mode))],attackFrames:[...new Set(rows.filter(r=>r.mode==='attack').map(r=>r.frame))],aims:[...new Set(rows.filter(r=>r.mode==='attack').map(r=>r.aim))],attackFacings:[...new Set(rows.filter(r=>r.mode==='attack').map(r=>r.facing))],variants:[...new Set(rows.filter(r=>r.mode==='attack').map(r=>r.variant))]};});
 const attackReleases=releases.filter((r:any)=>actors.some(u=>u.id===r.sourceId)&&r.actionMode==='attack');
 const passed=glError===0&&drawMutations.length===0&&summons.length===6&&actualDeaths.length===6&&picks.length===24&&picks.every((p:any)=>p.matched)&&seen.every(s=>s.modes.includes('idle')&&s.modes.includes('walk')&&s.modes.includes('attack')&&[0,1,2,3,4].every(f=>s.attackFrames.includes(f))&&s.attackFacings.every(f=>f===s.lane!.facing)&&s.aims.every(a=>a===s.lane!.aim*4))&&attackReleases.length>=12;
 presentation.dispose();canvas.remove();
 return{frames,canvasFrames,fps:20,summons,initialSnapshotSha256,snapshotHashes,snapshots,commands,scriptedExits,releases,samples,picks,portraits:portraits.map(({kind,png,bodyPng})=>({kind,png,bodyPng})),actualDeaths,seen,drawMutations,glError,renderer,passed,captures:CAPTURES,socketSamples,
 method:'Six original summon commands create real timed spirits with unmodified catalog stats. Casters leave through the original scripted-exit API after eight ticks, to isolate summoned-body combat. Real move/hold/attack commands target six native soldiers at both facings and up 60/horizontal/down 60 degrees. Every original simulation tick is rendered: release modes/vectors, all five attack frames, facing, picks, checksum and full snapshots are recorded. Canvas world and actual Atlas portraits/figures/remains are additionally captured. Six explicitly scripted original strikeUnit calls settle real deaths; no synthetic corpse or spirit cast skill. No performance claim.'};
}
Object.assign(window,{spiritGameplayProof});
