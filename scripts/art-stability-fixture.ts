/** Sustained production lifecycle workload; sampling is a separate CDP reader. */
import {createGame,issuePlayerCommand,snapshotGame,stepGame} from '../src/shared/sim';
import {WorldPresentation} from '../src/client/world-presentation';
import {UnitAnimationTracker} from '../src/client/unit-animation';
import {UnitFacingTracker} from '../src/client/unit-facing';
import {CombatPresentationTracker} from '../src/client/combat-presentation';
import {UnitMotionSmoother} from '../src/client/unit-motion';
import {drawAtlasUnitPortrait,drawAtlasBuildingPortrait,canvasArtCacheStats} from '../src/client/atlas-art';
import {fittedPortraitStats} from '../src/client/art/portrait-fit';
import {modelPortraitStats} from '../src/client/world3d/model-portraits';
import {appearanceFor} from '../src/client/art/unit-appearance';
import {resources} from '../src/client/resources';
import {worldModels} from '../src/client/world3d/model-library';
import type {WorldFrame} from '../src/client/world-renderer';
import type {UnitKind} from '../src/shared/types';

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let presentation:WorldPresentation|undefined,canvas:HTMLCanvasElement|undefined,frame:WorldFrame|undefined;
let game:ReturnType<typeof createGame>,heroId='',weaponId='',round=0,lastSwap=-1;
let running=false,stopped=false,failure='',started=0,frames=0,simTicks=0,swaps=0,prepares=0,disposes=0,deaths=0,hits=0,casts=0;
let stage='loading',lastDuration=0,maxDuration=0,rasterBeforeReset=0,retainedBeforeReset=0;
let releaseRecord:unknown=null;
const seenEffects=new Set<string>(),modes:Record<string,number>={};let evictedKeys=0,lastKeys=new Set<string>(),peakBattleCards=0;
const kinds:UnitKind[]=['footman','lancer','archer','priest','summoner','knight','horseArcher','ashWarden','sparkArcher','ashHexer','raider','worker'];
function newRound(){
 seenEffects.clear();game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
 for(const key of ['units','items','buildings','resources','mercenaryCamps','shops','obstacles','effects','projectiles'] as const)(game[key] as unknown[])=[];
 for(let i=0;i<24;i++){
  const side=i%2,slot=Math.floor(i/2),kind=kinds[(slot+round)%kinds.length]!;
  const u=game.spawnUnit(side?'enemy':'player',kind,side?1100:780,650+slot*24);
  u.hp=Math.max(1,Math.round(u.maxHp*.65));u.order={type:'attackMove',x:side?760:1120,y:u.y};
 }
 const hero=game.spawnUnit('player','footman',930,1030);heroId=hero.id;
 weaponId=`soak-sword-${round}`;game.items.push({id:weaponId,kind:'greatSword',x:hero.x,y:hero.y,cooldownRemaining:0});
 issuePlayerCommand(game,'player',{type:'pickupItem',unitId:heroId,itemId:weaponId});lastSwap=-1;
 frame={ctx:canvas!.getContext('2d')!,snapshot:snapshotGame(game),view:{x:650,y:500,width:960,height:640,zoom:1.2},now:0,facing:new UnitFacingTracker(),animation:new UnitAnimationTracker(),motion:new UnitMotionSmoother(),combat:new CombatPresentationTracker(),labels:{mercenaryStock:()=>'',unitKind:k=>k},still:true};round++;
}
function state(){
 const layer=(presentation as any)?.layer,renderer=layer?.renderer;
 return{elapsedMs:started?performance.now()-started:0,stage,running,stopped,failure,frames,simTicks,round,swaps,prepares,disposes,deaths,hits,casts,modes,evictedKeys,peakBattleCards,lastDuration,maxDuration,rasterBeforeReset,retainedBeforeReset,releaseRecord,
  is3D:presentation?.is3D??false,units:game?.units.length,cards:layer?.cardStats(),remains:layer?.remainsStats(),combat:layer?.combatStats(),canvas:canvasArtCacheStats(),portraits:fittedPortraitStats(),modelPortraits:modelPortraitStats(),
  resources:resources.cacheStats(),models:worldModels.cacheStats(),sceneObjects:layer?.scene.children.length,renderer:renderer?{memory:{...renderer.info.memory},programs:renderer.info.programs?.length,render:{...renderer.info.render}}:null,
  domCanvases:document.querySelectorAll('canvas').length,glError:renderer?.getContext().getError()??0};
}
async function run(seconds=1800){
 if(running)throw Error('Already running');running=true;started=performance.now();
 const hud=document.createElement('canvas');hud.width=400;hud.height=120;document.body.append(hud);const hudCtx=hud.getContext('2d')!;
 try{
  await resources.initialize();let nextRound=0,nextScene=0,nextLifetime=0;
  while(!stopped&&performance.now()-started<seconds*1000){
   const elapsed=(performance.now()-started)/1000;
   if(elapsed>=nextLifetime){
    if(presentation){stage='dispose';const old=(presentation as any).layer;presentation.dispose();releaseRecord={cards:old.cardStats(),remains:old.remainsStats(),geometries:old.renderer?.info.memory.geometries};canvas!.remove();presentation=undefined;frame=undefined;disposes++;await sleep(1500);}
    canvas=document.createElement('canvas');canvas.width=960;canvas.height=640;document.body.append(canvas);presentation=new WorldPresentation(canvas);nextLifetime=prepares===0?1200:elapsed+600;nextScene=elapsed;nextRound=elapsed;
   }
   if(elapsed>=nextRound){newRound();nextRound=elapsed+40;}
   if(elapsed>=nextScene){stage='prepare';const old=(presentation as any).layer;rasterBeforeReset+=old?.cardStats().rasterizations??0;retainedBeforeReset+=old?.cardStats().cards??0;await presentation!.prepare(frame!.snapshot,'match');lastKeys.clear();prepares++;nextScene=elapsed<600?600:elapsed+120;}
   stage='battle';const at=performance.now();const swap=Math.floor(game.tick/40);
   if(swap!==lastSwap&&game.units.some(u=>u.id===heroId&&u.hp>0)){issuePlayerCommand(game,'player',{type:'wieldItem',unitId:heroId,hand:'right',...(swap%2?{itemId:weaponId}:{})});lastSwap=swap;swaps++;}
   const before=game.units.length;stepGame(game);simTicks++;deaths+=Math.max(0,before-game.units.length);
   frame!.snapshot=snapshotGame(game);frame!.now=game.tick*50;presentation!.draw(frame!,'match');frames++;
   if(!presentation!.is3D)throw Error('Unexpected Canvas fallback');
   for(const e of game.effects)if(!seenEffects.has(e.id)){seenEffects.add(e.id);if(e.type==='hit')hits++;if(['heal','summon','curse'].includes(e.type))casts++;}
   for(const u of frame!.snapshot.units){const mode=frame!.animation!.frame(u,frame!.now).mode;modes[mode]=(modes[mode]??0)+1;}
   const cache=(presentation as any).layer.cards;const keys=new Set<string>(cache.cards.keys());for(const key of lastKeys)if(!keys.has(key))evictedKeys++;lastKeys=keys;peakBattleCards=Math.max(peakBattleCards,keys.size);
   if(frames%10===0){hudCtx.clearRect(0,0,400,120);const hero=game.units.find(u=>u.id===heroId);if(hero)drawAtlasUnitPortrait(hudCtx,hero.kind,0,0,100,'#557e9d',appearanceFor(frame!.snapshot,hero));drawAtlasUnitPortrait(hudCtx,kinds[(round+frames/10)%kinds.length]!,110,0,100,'#a05242');hudCtx.save();hudCtx.translate(230,0);drawAtlasBuildingPortrait(hudCtx,round%2?'barracks':'cinderSpire',100,'#557e9d');hudCtx.restore();}
   lastDuration=performance.now()-at;maxDuration=Math.max(maxDuration,lastDuration);
   // No retained frames, snapshots, base64 images or per-frame samples. No forced GC.
   await sleep(Math.max(50,150-lastDuration));
  }
  stage='final-release';const old=(presentation as any)?.layer;presentation?.dispose();releaseRecord={cards:old?.cardStats(),remains:old?.remainsStats()};canvas?.remove();presentation=undefined;frame=undefined;disposes++;hud.remove();await sleep(15000);stage='complete';
 }catch(error){failure=String((error as Error).stack??error);stage='failed';}finally{running=false;stopped=true;}
 return state();
}
Object.assign(window,{artStability:{run,state,stop:()=>{stopped=true;}}});
