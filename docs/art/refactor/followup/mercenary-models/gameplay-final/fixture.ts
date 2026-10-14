/** Real hiring, commands, releases and death records with the production renderer. */
import {waitForArtGpuCompletion} from '/@fs/workspace/sketch-rts-viewport/scripts/art-gpu-completion.mjs';
import {createGame,issuePlayerCommand,snapshotGame,stepGame,strikeUnit} from '/@fs/workspace/sketch-rts-viewport/src/shared/sim.ts';
import {checksumGame} from '/@fs/workspace/sketch-rts-viewport/src/shared/sim/checksum.ts';
import {MERCENARY_UNIT_KINDS,UNIT_DEFS} from '/@fs/workspace/sketch-rts-viewport/src/shared/catalog.ts';
import {seconds} from '/@fs/workspace/sketch-rts-viewport/src/shared/time.ts';
import type {MercenaryCamp,MercenaryUnitKind,Unit} from '/@fs/workspace/sketch-rts-viewport/src/shared/types.ts';
import {WorldPresentation} from '/@fs/workspace/sketch-rts-viewport/src/client/world-presentation.ts';
import {UnitAnimationTracker} from '/@fs/workspace/sketch-rts-viewport/src/client/unit-animation.ts';
import {UnitFacingTracker} from '/@fs/workspace/sketch-rts-viewport/src/client/unit-facing.ts';
import {CombatPresentationTracker} from '/@fs/workspace/sketch-rts-viewport/src/client/combat-presentation.ts';
import {projectActionFrame} from '/@fs/workspace/sketch-rts-viewport/src/client/art/action-direction.ts';
import {appearanceFor,corpseAppearanceFor} from '/@fs/workspace/sketch-rts-viewport/src/client/art/unit-appearance.ts';
import {drawAtlasUnitPortrait,drawAtlasUnitFigure,drawAtlasCorpse} from '/@fs/workspace/sketch-rts-viewport/src/client/atlas-art.ts';
import type {WorldFrame} from '/@fs/workspace/sketch-rts-viewport/src/client/world-renderer.ts';

const WIDTH=1440,HEIGHT=1000;
const bases:Record<MercenaryUnitKind,'footman'|'archer'|'priest'>={mercenary:'footman',contractArcher:'archer',fieldMedic:'priest'};
const color='#6b7f68';
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
async function hash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');}

export async function combatEffectsProof(){
 const camps:MercenaryCamp[]=MERCENARY_UNIT_KINDS.map((hireKind,i)=>({id:`merc-art-hire-${hireKind}`,x:520+i*410,y:470,
  radius:hireKind==='mercenary'?54:50,hireKind,cost:UNIT_DEFS[hireKind].cost,stock:hireKind==='mercenary'?5:3,
  cooldown:seconds(hireKind==='mercenary'?9:hireKind==='contractArcher'?16:18),cooldownRemaining:0}));
 const game=createGame('bareDuel',{aiPlayers:[],scenario:{addMercenaryCamps:camps,addBuildings:[
  {id:'merc-art-farm-1',owner:'player',kind:'farm',x:480,y:1200,complete:true},
  {id:'merc-art-farm-2',owner:'player',kind:'farm',x:620,y:1200,complete:true},
 ]}});game.scriptedVictory=true;
 // Only the scenario's starting wallet is set. All price, cap, proximity,
 // stock and cooldown checks still run through the real hire command.
 game.players.player.gold=1000;
 const sales:object[]=[],actors:Unit[]=[];
 for(const camp of game.mercenaryCamps.filter(c=>c.id.startsWith('merc-art-hire-'))){
  const courier=game.spawnUnit('player','footman',camp.x-88,camp.y+34);
  issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[courier.id]});
  const ids=new Set(game.units.map(u=>u.id)),gold=game.players.player.gold,stock=camp.stock;
  // spawnUnit is scenario setup; the next real hire command settles its supply
  // counter. Compare actual living bodies rather than a stale setup counter.
  const supply=game.units.filter(u=>u.owner==='player').reduce((n,u)=>n+UNIT_DEFS[u.kind].supplyUsed,0);
  issuePlayerCommand(game,'player',{type:'hire',campId:camp.id});
  const unit=game.units.find(u=>!ids.has(u.id));
  assert(unit&&unit.kind===camp.hireKind,`Real hire did not create ${camp.hireKind}`);
  assert(game.players.player.gold===gold-camp.cost,`Wrong actual price ${camp.hireKind}`);
  assert(camp.stock===stock-1&&camp.cooldownRemaining===camp.cooldown,`Wrong camp stock/cooldown ${camp.hireKind}`);
  assert(game.players.player.supplyUsed===supply+UNIT_DEFS[camp.hireKind].supplyUsed,`Wrong supply ${camp.hireKind}`);
  actors.push(unit!);
  sales.push({campId:camp.id,kind:camp.hireKind,unitId:unit!.id,price:camp.cost,goldBefore:gold,goldAfter:game.players.player.gold,
   stockBefore:stock,stockAfter:camp.stock,cooldown:camp.cooldown,cooldownRemaining:camp.cooldownRemaining,
   supplyBefore:supply,supplyAfter:game.players.player.supplyUsed,supplyCap:game.players.player.supplyCap,
   hp:unit!.hp,maxHp:unit!.maxHp,attackDamage:unit!.attackDamage,attackRange:unit!.attackRange,attackCooldown:unit!.attackCooldown});
  issuePlayerCommand(game,'player',{type:'holdPosition',unitIds:[unit!.id]});
  issuePlayerCommand(game,'player',{type:'move',unitIds:[courier.id],x:camp.x-150,y:camp.y-60});
 }
 assert(actors.length===3,'All real mercenary kinds must be hired');
 const hiredAt=snapshotGame(game),hireSnapshotSha256=await hash(hiredAt);
 const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;document.body.append(canvas);
 const presentation=new WorldPresentation(canvas),animation=new UnitAnimationTracker(),combat=new CombatPresentationTracker();
 const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:hiredAt,view:{x:320,y:260,width:WIDTH,height:HEIGHT,zoom:1.1},now:0,
  facing:new UnitFacingTracker(),animation,combat,labels:{mercenaryStock:stock=>String(stock),unitKind:k=>k},viewer:'player'};
 const originalGetContext=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type:string,options?:Record<string,unknown>){return originalGetContext.call(this,type,type==='webgl2'?{...options,preserveDrawingBuffer:true}:options);} as typeof originalGetContext;
 try{await presentation.prepare(frame.snapshot,'home');}finally{HTMLCanvasElement.prototype.getContext=originalGetContext;}
 assert(presentation.is3D,'Proof needs the production WebGL model/card layer');
 const actorCanvas=document.querySelector<HTMLCanvasElement>('.world-actors')!,gl=actorCanvas.getContext('webgl2')!;
 assert(gl.getContextAttributes()?.preserveDrawingBuffer,'Capture needs a preserved native GPU buffer');
 const composite=document.createElement('canvas');composite.width=WIDTH;composite.height=HEIGHT;const out=composite.getContext('2d')!;
 const portraits=MERCENARY_UNIT_KINDS.map(kind=>{
  const c=document.createElement('canvas');c.width=112;c.height=112;
  drawAtlasUnitPortrait(c.getContext('2d')!,kind,0,0,112,color);
  const generic=document.createElement('canvas');generic.width=generic.height=112;drawAtlasUnitPortrait(generic.getContext('2d')!,bases[kind],0,0,112,color);
  assert(c.toDataURL()!==generic.toDataURL(),`${kind} still uses the ordinary ${bases[kind]} portrait`);
  const rgba=c.getContext('2d')!.getImageData(0,0,112,112).data;
  assert(rgba.some((v,i)=>i%4===3&&v>0),`${kind} portrait is empty`);
  const body=document.createElement('canvas');body.width=112;body.height=150;drawAtlasUnitFigure(body.getContext('2d')!,kind,112,150,color);
  return{kind,canvas:c,body,ordinaryPng:generic.toDataURL('image/png'),png:c.toDataURL('image/png'),bodyPng:body.toDataURL('image/png')};
 });
 const frames:string[]=[],samples:object[]=[],snapshotHashes:string[]=[],releaseIds=new Set<string>();
 const releases:object[]=[],picks:object[]=[],drawMutations:object[]=[],commands:object[]=[],actualDeaths:object[]=[];
 const targets=new Map<string,Unit>();let injured:Unit|undefined;
 const run=(command:Parameters<typeof issuePlayerCommand>[2])=>{issuePlayerCommand(game,'player',command);commands.push({tick:game.tick,command});};
 for(let capture=0;capture<40;capture++){
  if(capture===2)for(const [i,unit]of actors.entries())run({type:'move',unitIds:[unit.id],x:530+i*410,y:665});
  if(capture===18){
   for(const [i,unit]of actors.entries()){
    run({type:'holdPosition',unitIds:[unit.id]});
    const aim=i===1?1:-1,target=game.spawnUnit('enemy','footman',unit.x+38,unit.y+aim*65.8);
    // The melee patient's low initial health is a normal scenario fact. Native
    // damage and cooldowns decide the actual kill; ranged targets keep full HP.
    if(i===0)target.hp=20;
    issuePlayerCommand(game,'enemy',{type:'holdPosition',unitIds:[target.id]});targets.set(unit.id,target);
    if(i<2)run({type:'attack',unitIds:[unit.id],targetId:target.id});
   }
   const medic=actors[2]!;injured=game.spawnUnit('player','footman',medic.x-68,medic.y+42);injured.hp=30;
   run({type:'holdPosition',unitIds:[injured.id]});run({type:'cast',unitId:medic.id,ability:'heal',targetId:injured.id});
  }
  if(capture===23){const medic=actors[2]!;run({type:'attack',unitIds:[medic.id],targetId:targets.get(medic.id)!.id});}
  if(capture===28){const swordsman=actors[0]!;run({type:'move',unitIds:[swordsman.id],x:swordsman.x-60,y:swordsman.y+48});}
  if(capture===34){
   for(const unit of actors){
    if(!game.units.includes(unit))continue;
    const attacker=game.spawnUnit('enemy','footman',unit.x+52,unit.y+22);
    issuePlayerCommand(game,'enemy',{type:'holdPosition',unitIds:[attacker.id]});
    const before={hp:unit.hp,kind:unit.kind,x:unit.x,y:unit.y};
    strikeUnit(game,attacker,unit,unit.maxHp+unit.hp+100,'melee');stepGame(game);
    const corpse=game.corpses!.find(c=>c.unitId===unit.id);assert(corpse,`Real strike did not create ${unit.kind} remains`);
    actualDeaths.push({tick:game.tick,sourceId:attacker.id,method:'Explicitly scripted strikeUnit through real damage/death/equipment rules; unit stats unchanged',before,corpse});
   }
  }
  frame.snapshot=snapshotGame(game);frame.now=game.tick*50;const beforeDraw=checksumGame(game);
  snapshotHashes.push(await hash(frame.snapshot));presentation.draw(frame,'home');await waitForArtGpuCompletion(gl);
  const afterDraw=checksumGame(game);if(beforeDraw!==afterDraw)drawMutations.push({tick:game.tick,beforeDraw,afterDraw});
  assert(presentation.is3D,`Unexpected Canvas fallback at tick ${game.tick}`);
  for(const effect of frame.snapshot.effects){
   if(effect.sourceId&&actors.some(u=>u.id===effect.sourceId)&&effect.actionMode&&!releaseIds.has(effect.id)){
    releaseIds.add(effect.id);releases.push({id:effect.id,tick:game.tick,actionTick:effect.actionTick,actionMode:effect.actionMode,sourceId:effect.sourceId,type:effect.type,fromX:effect.fromX,fromY:effect.fromY,toX:effect.toX,toY:effect.toY});
   }
  }
  for(const unit of actors){
   const alive=frame.snapshot.units.find(u=>u.id===unit.id);if(!alive)continue;
   const position=presentation.position(unit.id)!,raw=animation.frame(alive,frame.now),facing=position.facing??1,pose=projectActionFrame(raw,facing);
   const row={capture,tick:game.tick,kind:unit.kind,id:unit.id,hp:unit.hp,x:unit.x,y:unit.y,facing,mode:pose.mode,frame:pose.frame,aim:pose.aim??0,carry:pose.carry??0,carryAim:pose.carryAim??0,appearance:appearanceFor(frame.snapshot,alive)};
   samples.push(row);
   if(capture===0||capture===18||capture===26){
    let picked:ReturnType<WorldPresentation['pick']>;
    // Search the visible torso at real projected world positions, not an ID
    // override. Transparent masks can legitimately reject an empty pixel.
    for(const y of [22,30,38,46])for(const x of [-4,0,4])if(picked?.id!==unit.id)
     picked=presentation.pick({x:(position.x-frame.view.x)*frame.view.zoom+x,y:(position.bodyY-frame.view.y)*frame.view.zoom-y*frame.view.zoom});
    picks.push({capture,tick:game.tick,id:unit.id,kind:unit.kind,pickedId:picked?.id??null,matched:picked?.id===unit.id});
   }
  }
  out.clearRect(0,0,WIDTH,HEIGHT);for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,WIDTH,HEIGHT);out.drawImage(canvas,0,0);
  out.fillStyle='#e5ddc7f2';out.fillRect(0,0,WIDTH,58);out.fillStyle='#343b36';out.font='21px sans-serif';out.fillText('Hired companies / real hire commands + production WebGL + original combat rules',20,26);
  out.font='15px sans-serif';out.fillText(`Tick ${game.tick} / ${capture<18?'Hire and movement':capture<34?'Native attacks, heal and carried readiness':'Real scripted deaths and independent remains'} / Initial wallet after hiring: 540 / 160 + 145 + 155 gold`,20,47);
  out.fillStyle='#e5ddc7f0';out.fillRect(0,780,WIDTH,220);
  for(const [i,portrait]of portraits.entries()){
   const x=30+i*465;out.drawImage(portrait.canvas,x,825);out.drawImage(portrait.body,x+125,806);out.fillStyle='#343b36';out.font='19px sans-serif';out.fillText(portrait.kind,x,803);
   out.font='14px sans-serif';out.fillText('Actual selection portrait / equipment figure',x,974);
   const unit=actors[i]!,alive=frame.snapshot.units.find(u=>u.id===unit.id),corpse=frame.snapshot.corpses?.find(c=>c.unitId===unit.id);
   if(alive){const position=presentation.position(unit.id)!,raw=animation.frame(alive,frame.now);out.fillText(`${raw.mode} ${raw.frame} / facing ${position.facing} / carry ${raw.carry??0}`,x+252,872);}
   if(corpse){out.save();out.translate(x+330,877);out.scale(2.3,2.3);drawAtlasCorpse(out,corpse.kind,{x:0,y:0},1,0,undefined,'',color,corpseAppearanceFor(frame.snapshot,corpse));out.restore();out.fillText('Actual death record / own remains',x+235,937);}
  }
  frames.push(composite.toDataURL('image/png'));
  for(let tick=0;tick<3;tick++)stepGame(game);
 }
 const glError=gl.getError(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const seen=MERCENARY_UNIT_KINDS.map(kind=>{const rows=samples.filter((s:any)=>s.kind===kind) as {mode:string;carry:number}[];return{kind,modes:[...new Set(rows.map(s=>s.mode))],carried:rows.some(s=>s.carry>0)};});
 const medic=actors[2]!,healSeen=releases.some((r:any)=>r.sourceId===medic.id&&r.actionMode==='cast')&&(injured?.hp??0)>30;
 const attacks=MERCENARY_UNIT_KINDS.map(kind=>({kind,seen:releases.some((r:any)=>r.sourceId===actors.find(u=>u.kind===kind)!.id&&r.actionMode==='attack')}));
 const passed=glError===0&&drawMutations.length===0&&sales.length===3&&picks.length===9&&picks.every((p:any)=>p.matched)&&healSeen&&attacks.every(s=>s.seen)&&actualDeaths.length===3;
 presentation.dispose();canvas.remove();
 return{frames,fps:20/3,sales,hireSnapshotSha256,snapshotHashes,commands,releases,samples,picks,portraits:portraits.map(({kind,png,ordinaryPng,bodyPng})=>({kind,png,ordinaryPng,bodyPng})),actualDeaths,seen,healSeen,attacks,drawMutations,glError,renderer,passed,
  method:'Three native hire commands with real proximity, prices, stock, cooldown and supply checks; original catalog stats. Real move/attack/heal commands and original release-driven animation. Forty production WebGL captures, three real simulation ticks between captures; three extra death-settlement ticks. Three explicitly scripted real lethal strikeUnit calls validate real death/corpse routes. UI portraits/full figures use production Canvas entries. No forced animation or synthetic corpse. No performance claim.'};
}
Object.assign(window,{combatEffectsProof});
