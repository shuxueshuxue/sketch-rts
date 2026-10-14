/** Original summons/attacks/damage and production blood presentation. No stat changes. */
import {waitForArtGpuCompletion} from '/@fs/workspace/sketch-rts-viewport/scripts/art-gpu-completion.mjs';
import {createGame,issuePlayerCommand,removeUnit,snapshotGame,stepGame,strikeUnit} from '/@fs/tmp/sketch-spirit-no-blood-before/src/shared/sim.ts';
import {checksumGame} from '/@fs/tmp/sketch-spirit-no-blood-before/src/shared/sim/checksum.ts';
import {UNIT_DEFS,ABILITY_DEFS} from '/@fs/tmp/sketch-spirit-no-blood-before/src/shared/catalog.ts';
import type {GameSnapshot,Unit,UnitKind,WorldEffect} from '/@fs/tmp/sketch-spirit-no-blood-before/src/shared/types.ts';
import {WorldPresentation} from '/@fs/tmp/sketch-spirit-no-blood-before/src/client/world-presentation.ts';
import {drawWorld,type WorldFrame} from '/@fs/tmp/sketch-spirit-no-blood-before/src/client/world-renderer.ts';
import {UnitAnimationTracker} from '/@fs/tmp/sketch-spirit-no-blood-before/src/client/unit-animation.ts';
import {UnitFacingTracker} from '/@fs/tmp/sketch-spirit-no-blood-before/src/client/unit-facing.ts';
import {CombatPresentationTracker,isBloodHit} from '/@fs/tmp/sketch-spirit-no-blood-before/src/client/combat-presentation.ts';
import {bloodSurfaceResolver} from '/@fs/tmp/sketch-spirit-no-blood-before/src/client/combat-surfaces.ts';
import {BloodContacts,type BloodPoint} from '/@fs/tmp/sketch-spirit-no-blood-before/src/client/blood-contact.ts';

const WIDTH=1200,HEIGHT=800,ZOOM=2;
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const createCanvas=()=>{const c=document.createElement('canvas');c.width=WIDTH;c.height=HEIGHT;return c;};
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
async function hash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');}
const fresh=()=>{const game=createGame('bareDuel',{aiPlayers:[],scenario:{replaceDefaultUnits:true,replaceDefaultBuildings:true,replaceDefaultResources:true,replaceDefaultMercenaryCamps:true,replaceDefaultLandmarks:true}});game.scriptedVictory=true;return game;};
const counts=(frame:ReturnType<CombatPresentationTracker['frame']>)=>({air:frame.droplets.length,ground:frame.ground.length,body:frame.body.length});
const closeHit=(effect:WorldEffect)=>effect.type==='hit'&&Number.isFinite(effect.damage)&&effect.damage!>0&&effect.targetHpAfter!<=effect.damage!*2;

export async function spiritNoBloodProof(){
 const expectSpiritBlood=!!(window as unknown as {expectSpiritBlood:boolean}).expectSpiritBlood;
 const frames:string[]=[],canvasFrames:object[]=[],snapshots:object[]=[],snapshotHashes:string[]=[],summons:object[]=[],commands:object[]=[],hits:object[]=[],actualDeaths:object[]=[],drawMutations:object[]=[],captureRecords:object[]=[],phases:object[]=[];
 const seenEffects=new Set<string>();let frameIndex=0;
 for(const name of ['native-spirit','physical-controls','neighbor-transfer'] as const){
  const game=fresh(),actors:Unit[]=[],run=(owner:'player'|'enemy',command:Parameters<typeof issuePlayerCommand>[2])=>{issuePlayerCommand(game,owner,command);commands.push({phase:name,tick:game.tick,owner,command});};
  let spirit:Unit|undefined,attacker:Unit|undefined,receiver:Unit|undefined,deadTick:number|undefined;
  const summoned=(x:number,y:number)=>{
   const caster=game.spawnUnit('player','summoner',x,y-170);run('player',{type:'holdPosition',unitIds:[caster.id]});
   const ids=new Set(game.units.map(u=>u.id));run('player',{type:'cast',unitId:caster.id,ability:'summon',x,y});
   const unit=game.units.find(u=>!ids.has(u.id))!;assert(unit?.kind==='spirit','Original summon failed');
   assert(unit.hp===UNIT_DEFS.spirit.hp&&unit.expiresTick===game.tick+ABILITY_DEFS.summon.summonDuration,'Original spirit facts changed');
   summons.push({phase:name,casterId:caster.id,tick:game.tick,unit:copy(unit)});removeUnit(game,caster.id);
   commands.push({phase:name,tick:game.tick,scriptedExit:caster.id,method:'Original removeUnit after real summon, isolating the victim from its caster'});run('player',{type:'holdPosition',unitIds:[unit.id]});return unit;
  };
  if(name==='native-spirit'){
   spirit=summoned(930,660);actors.push(spirit);attacker=game.spawnUnit('enemy','footman',980,660);
   run('enemy',{type:'attack',unitIds:[attacker.id],targetId:spirit.id});
  }else if(name==='physical-controls'){
   for(const [i,kind]of (['footman','wildling','graniteGolem'] as UnitKind[]).entries()){
    const target=game.spawnUnit('player',kind,780+i*180,660),source=game.spawnUnit('enemy','footman',target.x-95,target.y);actors.push(target);
    run('player',{type:'holdPosition',unitIds:[target.id]});run('enemy',{type:'holdPosition',unitIds:[source.id]});
    const before={hp:target.hp,maxHp:target.maxHp,stats:{damage:target.attackDamage,range:target.attackRange,cooldown:target.attackCooldown}};
    const scriptedDamage=Math.ceil(target.maxHp*.8);strikeUnit(game,source,target,scriptedDamage,'melee');
    commands.push({phase:name,tick:game.tick,scriptedStrike:{sourceId:source.id,targetId:target.id,scriptedDamage,before},method:'Explicitly scripted original strikeUnit damage pipeline; neither target nor source stats are modified'});
   }
  }else{
   const victim=game.spawnUnit('player','footman',885,660);spirit=summoned(921,660);receiver=game.spawnUnit('player','footman',849,660);actors.push(victim,spirit,receiver);
   attacker=game.spawnUnit('enemy','footman',810,660);for(const unit of [victim,receiver,attacker])run(unit.owner as 'player'|'enemy',{type:'holdPosition',unitIds:[unit.id]});
   const scriptedDamage=Math.ceil(victim.maxHp*.8);strikeUnit(game,attacker,victim,scriptedDamage,'melee');
   run('enemy',{type:'move',unitIds:[attacker.id],x:650,y:660});
   commands.push({phase:name,tick:game.tick,scriptedStrike:{sourceId:attacker.id,targetId:victim.id,scriptedDamage},method:'Real footman hit metadata through original strikeUnit; nearby spirit and physical receiver remain ordinary simulation bodies'});
  }
  const canvas=createCanvas();document.body.append(canvas);const presentation=new WorldPresentation(canvas),animation=new UnitAnimationTracker(),facing=new UnitFacingTracker(),combat=new CombatPresentationTracker();
  const frame:WorldFrame={ctx:canvas.getContext('2d')!,snapshot:snapshotGame(game),view:{x:640,y:470,width:WIDTH,height:HEIGHT,zoom:ZOOM},now:0,animation,facing,combat,viewer:'player',selectedIds:new Set(actors.map(u=>u.id)),labels:{mercenaryStock:stock=>String(stock),unitKind:k=>k}};
  const originalGetContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(type:string,options?:Record<string,unknown>){return originalGetContext.call(this,type,type==='webgl2'?{...options,preserveDrawingBuffer:true}:options);} as typeof originalGetContext;
  try{await presentation.prepare(frame.snapshot,'home');}finally{HTMLCanvasElement.prototype.getContext=originalGetContext;}
  assert(presentation.is3D,'Actual production WebGL is required');const gl=document.querySelector<HTMLCanvasElement>('.world-actors')!.getContext('webgl2')!;assert(gl.getContextAttributes()?.preserveDrawingBuffer,'Preserved GPU proof buffer required');
  const composite=createCanvas(),out=composite.getContext('2d')!,fallback=createCanvas(),fallbackCombat=new CombatPresentationTracker(),fallbackAnimation=new UnitAnimationTracker(),fallbackFacing=new UnitFacingTracker();
  const fallbackFrame:WorldFrame={...frame,ctx:fallback.getContext('2d')!,combat:fallbackCombat,animation:fallbackAnimation,facing:fallbackFacing};
  const rows:object[]=[],phaseHits:WorldEffect[]=[],newHitIds=new Set<string>(),nearHits:WorldEffect[]=[],captures=new Set(name==='native-spirit'?[0,1,2]:[0,1,2,4,8,16,30,60,120,180,190]);
  let maxAir=0,maxGround=0,maxBody=0,receiverStained=false,spiritStained=false,minSpiritDropDistance=Infinity;const nativeDeaths=new Set<string>();
  for(let localTick=0;localTick<=420;localTick++){
   const snapshot=snapshotGame(game),now=game.tick*50;frame.snapshot=snapshot;frame.now=now;
   const beforeDraw=checksumGame(game);animation.update(snapshot,now);facing.updateSnapshot(snapshot,id=>snapshot.units.find(u=>u.id===id));
   combat.update(snapshot,now,bloodSurfaceResolver(snapshot,animation,facing,undefined));
   fallbackAnimation.update(snapshot,now);fallbackFacing.updateSnapshot(snapshot,id=>snapshot.units.find(u=>u.id===id));fallbackCombat.update(snapshot,now,bloodSurfaceResolver(snapshot,fallbackAnimation,fallbackFacing,undefined));
   const blood=copy(combat.frame(now)),fallbackBlood=copy(fallbackCombat.frame(now)),fractional=counts(combat.frame(now+20));
   const current=counts(blood);maxAir=Math.max(maxAir,current.air);maxGround=Math.max(maxGround,current.ground);maxBody=Math.max(maxBody,current.body);
   if(spirit)spiritStained||=blood.body.some(mark=>mark.unitId===spirit!.id);if(receiver)receiverStained||=blood.body.some(mark=>mark.unitId===receiver!.id);
   if(name==='neighbor-transfer'&&spirit)for(const drop of blood.droplets)minSpiritDropDistance=Math.min(minSpiritDropDistance,Math.hypot(drop.x-spirit.x,drop.y-spirit.y));
   rows.push({localTick,tick:game.tick,hp:actors.map(u=>({id:u.id,kind:u.kind,hp:u.hp,x:u.x,y:u.y,alive:snapshot.units.some(s=>s.id===u.id)})),counts:current,fractional,fallbackCounts:counts(fallbackBlood),blood,fallbackBlood});
   snapshots.push({phase:name,localTick,tick:game.tick,snapshot});snapshotHashes.push(await hash(snapshot));
   for(const effect of snapshot.effects)if(effect.type==='hit'&&!newHitIds.has(effect.id)){
    newHitIds.add(effect.id);phaseHits.push(copy(effect));hits.push({phase:name,tick:game.tick,effect:copy(effect),qualifiesForBlood:isBloodHit(effect)});
    if(name==='native-spirit'&&effect.unitId===spirit!.id&&closeHit(effect)){
     nearHits.push(copy(effect));for(const dt of [0,1,2,4,8,20,120,180,190])captures.add(localTick+dt);
    }
   }
   for(const corpse of snapshot.corpses??[])if(!nativeDeaths.has(corpse.unitId)){nativeDeaths.add(corpse.unitId);actualDeaths.push({phase:name,tick:game.tick,corpse});}
   if(name==='native-spirit'&&!snapshot.units.some(u=>u.id===spirit!.id)&&deadTick===undefined){deadTick=localTick;for(const dt of [0,1,2,4,8,20,120,180,190])captures.add(localTick+dt);}
   if(captures.has(localTick)){
    presentation.draw(frame,'home');await waitForArtGpuCompletion(gl);assert(presentation.is3D,'Unexpected GPU fallback');
    fallbackFrame.snapshot=snapshot;fallbackFrame.now=now;drawWorld(fallbackFrame);
    canvasFrames.push({capture:frameIndex,phase:name,localTick,tick:game.tick,png:fallback.toDataURL('image/png')});
    out.clearRect(0,0,WIDTH,HEIGHT);for(const c of document.querySelectorAll<HTMLCanvasElement>('.world-ground,.world-actors'))if(!c.parentElement?.hidden)out.drawImage(c,0,0,WIDTH,HEIGHT);out.drawImage(canvas,0,0);
    out.fillStyle='#e5ddc7f2';out.fillRect(0,0,WIDTH,68);out.fillStyle='#343b36';out.font='21px sans-serif';out.fillText('Spirit blood policy / original game damage and production rendering',20,27);
    out.font='17px sans-serif';out.fillText(`${name} / tick ${game.tick} / ${name==='native-spirit'?'real summon + enemy attack command':'explicit original damage pipeline controls'} / ${localTick/20}s`,20,53);
    out.fillStyle='#e5ddc7f2';out.fillRect(0,650,WIDTH,150);out.fillStyle='#343b36';out.font='18px sans-serif';out.fillText('Selected evidence frames; the tick labels preserve the original simulation clock.',20,676);
    out.font='16px sans-serif';for(const [i,unit]of actors.entries())out.fillText(`${unit.kind} / HP ${Math.max(0,unit.hp)}/${unit.maxHp} / ${snapshot.units.some(u=>u.id===unit.id)?'alive':'actual death'}`,20,708+i*25);
    captureRecords.push({index:frameIndex,phase:name,localTick,tick:game.tick,counts:current,gpuInk:(presentation as unknown as {layer:{combatStats:()=>unknown}}).layer.combatStats()});frames.push(composite.toDataURL('image/png'));frameIndex++;
   }
   const afterDraw=checksumGame(game);if(beforeDraw!==afterDraw)drawMutations.push({phase:name,tick:game.tick,beforeDraw,afterDraw});
   if(name==='native-spirit'&&deadTick!==undefined&&localTick>=deadTick+190)break;
   if(name!=='native-spirit'&&localTick>=190)break;
   stepGame(game);
  }
  const glError=gl.getError();assert(glError===0,'GL error in '+name);
  const nativeSpiritHits=phaseHits.filter(e=>e.unitId===spirit?.id),allSpiritEmpty=rows.every((row:any)=>row.counts.air===0&&row.counts.ground===0&&row.counts.body===0&&row.fractional.air===0&&row.fractional.ground===0&&row.fractional.body===0&&row.fallbackCounts.air===0&&row.fallbackCounts.ground===0&&row.fallbackCounts.body===0);
  let passed=false;
  if(name==='native-spirit')passed=nearHits.some(e=>e.targetHpAfter!>0)&&nearHits.some(e=>e.targetHpAfter!<=0)&&deadTick!==undefined&&nativeSpiritHits.every(e=>e.targetKind==='spirit'&&e.targetUnitClass==='nonMechanical')&&(expectSpiritBlood?maxAir>0&&maxGround>0&&maxBody>0:allSpiritEmpty);
  else if(name==='physical-controls'){
   const controls=(['footman','wildling','graniteGolem'] as UnitKind[]).map(kind=>{const unit=actors.find(u=>u.kind===kind)!,effect=phaseHits.find(e=>e.unitId===unit.id)!;return{kind,id:unit.id,effect,qualifies:isBloodHit(effect),bodySeen:rows.some((r:any)=>r.blood.body.some((m:any)=>m.unitId===unit.id))};});
   passed=controls.every(c=>!!c.effect&&closeHit(c.effect)&&(c.kind==='graniteGolem'?!c.qualifies&&!c.bodySeen:c.qualifies&&c.bodySeen))&&maxAir>0&&maxGround>0;
  }else passed=phaseHits.some(e=>e.targetKind==='footman'&&closeHit(e)&&isBloodHit(e))&&!spiritStained&&receiverStained&&receiver!.hp===receiver!.maxHp&&phaseHits.every(e=>e.unitId!==receiver!.id)&&minSpiritDropDistance<15;
  const phase={name,passed,ticks:rows.length,deadTick:deadTick??null,seen:{maxAir,maxGround,maxBody,allSpiritEmpty,receiverStained,spiritStained,minSpiritDropDistance:Number.isFinite(minSpiritDropDistance)?minSpiritDropDistance:null},nativeSpiritHits,nearHits,phaseHits,rows,glError};phases.push(phase);
  presentation.dispose();canvas.remove();
 }
 return{frames,canvasFrames,fps:5,portraits:[],snapshots,snapshotHashes,summons,commands,hits,actualDeaths,drawMutations,captureRecords,phases,glError:0,passed:drawMutations.length===0&&phases.every((p:any)=>p.passed),expectSpiritBlood,
 method:'Isolated spirit: actual original summon and real enemy attack command, no HP/stat/cooldown edits. All simulation ticks from healthy through close-to-lethal hits and real death, then 190 more ticks (>9 seconds), update the production CombatPresentationTracker and independent Canvas tracker. Selected native GPU/Canvas captures show release, airborne period, landing and 6/9-second residue. Physical footman/wildling and mechanical granite-golem controls use explicitly scripted original strikeUnit damage calls, never synthetic hit effects or changed unit stats. Separate real footman hit with nearby actual summoned spirit and ordinary physical receiver exercises neighbor transfer. Videos contain selected evidence frames rather than realtime playback. No performance claim.'};
}
Object.assign(window,{spiritNoBloodProof});
