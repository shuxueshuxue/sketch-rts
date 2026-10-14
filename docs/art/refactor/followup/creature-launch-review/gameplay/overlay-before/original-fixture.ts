/** Real paid/blocked simulation plus production main button subset, not full app UI. */
import {createGame,issuePlayerCommand,stepGame,snapshotGame} from '../src/shared/sim';
import {createBuilding,createUnit} from '../src/shared/map';
import * as training from '../src/client/training-queue';
import {createI18n} from '../src/client/i18n';
import {TRAINABLE_UNIT_KINDS} from '../src/shared/catalog';
import {TRAINED_UNIT_CARDS} from '../src/client/content/units';
import {unitTooltip,formatTooltipDataset} from '../src/client/tooltips';
import {drawAtlasUnitPortrait,drawAtlasBuildingPortrait} from '../src/client/atlas-art';
import {UnitFacingTracker} from '../src/client/unit-facing';
import {ownerInk,drawWorld,worldLabelsFor} from '../src/client/world-renderer';
import {appearanceForKind,appearanceKey} from '../src/client/art/unit-appearance';
import {paintPortrait} from '../src/client/portrait-cache';
import {worldModels,snapshotModelKeys} from '../src/client/world3d/model-library';
import {activateModelPortraits} from '../src/client/world3d/model-portraits';
import {resources} from '../src/client/resources';
import '../src/client/battle-hud.css';
let i18n=createI18n('zh');const t=(...args:any[])=>(i18n.t as any)(...args),tl=(kind:any)=>i18n.label(kind);
const localPlayerId='player',TRAIN_COMMANDS=TRAINABLE_UNIT_KINDS.map(kind=>({kind,...TRAINED_UNIT_CARDS[kind].command}));
const trainingProgressText=(training as any).trainingProgressText;
let snapshot:any;const currentPlayerState=()=>snapshot.players.player;
const emitted:any[]=[];const sendCommand=(command:any)=>emitted.push(command);
/* MAIN_FUNCTIONS */
const must=(ok:unknown,msg:string)=>{if(!ok)throw Error(msg);};
async function hash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function creatureGameplayProof(){
 const game=createGame('bareDuel',{aiPlayers:[]});game.map={...game.map,width:1600,height:1280,terrain:{cell:32,cols:50,rows:40,cells:Array.from({length:40},()=>'.'.repeat(10)+'~'.repeat(40)).join('')}};
 game.units=[];game.items=[];game.resources=[];game.mercenaryCamps=[];game.shops=[];game.scriptedVictory=true;
 const dock=createBuilding('dock','player','shipyard',304,624,true);game.buildings=[dock,createBuilding('hall','player','townHall',96,96,true)];game.players.player.gold=10000;game.players.player.supplyCap=8;
 const initialGold=game.players.player.gold;
 for(let i=0;i<2;i++)issuePlayerCommand(game,'player',{type:'train',buildingId:dock.id,unitKind:'transport'});
 must(dock.queue.length===2,'Actual train payment failed');const paidGold=game.players.player.gold;
 for(let row=0;row<3;row++)for(let col=0;col<3;col++){const blocker=createUnit(`traffic-${row}-${col}`,'player','carrier',396+col*146,328+row*296);blocker.sailing={heading:Math.PI/2,speed:0,load:0,balance:0};blocker.order={type:'hold',x:blocker.x,y:blocker.y};game.units.push(blocker);}
 // No fabricated completed queue: run the native full training duration.
 let ticks=0;while(dock.queue[0]!.remaining>0&&ticks<3000){stepGame(game);ticks++;}
 must(dock.queue.length===2&&dock.queue[0]!.remaining===0,'Native blocked job not retained');snapshot=snapshotGame(game);const ready=snapshot,readyHash=await hash(ready);
 await resources.initialize();await worldModels.prepare([...snapshotModelKeys(ready),'ships/transport'],'home');activateModelPortraits();
 document.body.className='game-shell';document.body.style.cssText='margin:0;background:#d8ceba;font:16px sans-serif;color:#302d25;padding:32px';
 const style=document.createElement('style');style.textContent='.proof-row{display:flex;align-items:start;gap:20px;margin:28px 0}.proof-buttons{display:flex;gap:4px;--hud-button-width:52px;--hud-button-height:55px;background:var(--battle-surface);padding:12px;border-radius:6px}.proof-tooltip{background:var(--battle-surface);color:var(--battle-ink);padding:16px;width:420px;border:1px solid var(--battle-edge);border-radius:5px;line-height:1.6}.proof-tooltip strong{display:block;margin-bottom:8px}';document.head.append(style);
 const title=document.createElement('h2');title.textContent='Paid shipyard / native completed blocked queue / production button + CSS';document.body.append(title);
 const note=document.createElement('p');note.textContent=`Component screenshot, not full live main menu. Same actual simulation snapshot; ${ticks} native ticks; gold ${initialGold} → ${paidGold}.`;document.body.append(note);
 const states:any[]=[];
 for(const locale of ['zh','en'] as const){i18n=createI18n(locale);const row=document.createElement('div');row.className='proof-row';const buttons=document.createElement('div');buttons.className='proof-buttons';row.append(buttons);const projected=training.trainingProgressButtonsForSelection(ready.buildings.filter((b:any)=>b.id==='dock'));
  for(const progress of projected){const button=renderTrainingProgressButton(progress);buttons.append(button);}
  document.body.append(row);const first=buttons.querySelector('button')!;
  const tooltip=document.createElement('div');tooltip.className='proof-tooltip';const heading=document.createElement('strong');heading.textContent=first.dataset.tooltipTitle!;const body=document.createElement('div');body.textContent=first.dataset.tooltipBody!;tooltip.append(heading,body);row.append(tooltip);
  states.push({locale,projected,html:buttons.innerHTML,tooltip:{...first.dataset}});first.click();
 }
 must((await hash(snapshot))===readyHash,'Projection mutated snapshot');
 for(const blocker of game.units){blocker.x+=700;blocker.order={type:'hold',x:blocker.x,y:blocker.y};}stepGame(game);
 must(game.units.some(u=>u.kind==='transport')&&dock.queue.length===1,'Native unblock did not launch');
 const launched=snapshotGame(game);const afterLaunch=training.trainingProgressButtonsForSelection([dock]);
 const worldAnnotations:any[]=[];
 for(const locale of ['zh','en'] as const)for(const [state,scene]of [['blocked',ready],['cleared',launched]] as const)for(const pass of ['full','overlay'] as const){
  const art=document.createElement('canvas');art.width=960;art.height=720;const ctx=art.getContext('2d')!,texts:any[]=[];
  const fillText=ctx.fillText.bind(ctx);ctx.fillText=((text:string,x:number,y:number,maxWidth?:number)=>{texts.push({text,x,y,ink:String(ctx.fillStyle)});if(maxWidth===undefined)fillText(text,x,y);else fillText(text,x,y,maxWidth);}) as typeof ctx.fillText;
  const labels=worldLabelsFor(createI18n(locale)),before=await hash(scene);
  drawWorld({ctx,snapshot:scene,view:{x:100,y:280,width:960,height:720,zoom:1},now:scene.tick*50,...(pass==='overlay'?{pass:'overlay' as const}:{}),facing:new UnitFacingTracker(),labels,viewer:'player',still:true});
  must(await hash(scene)===before,'World annotation mutated actual snapshot');
  const waiting=labels.awaitingShipLaunch?.();
  if(waiting)must(texts.some(row=>row.text===waiting)===(state==='blocked'),'World waiting label did not follow actual queue');
  worldAnnotations.push({locale,state,pass,snapshotHash:before,texts,png:art.toDataURL(),scope:pass==='overlay'?'Actual production Canvas drawWorld overlay pass, transparent background, unselected shipyard. Not a complete WebGL frame.':'Actual full production Canvas drawWorld with native model fallback and worldLabelsFor; unselected shipyard. Not WebGL.'});
 }
 must(emitted.length===2&&emitted.every(c=>c.type==='cancelTraining'&&c.jobId===ready.buildings.find((b:any)=>b.id==='dock').queue[0].id),'Cancel callback changed');
 return{passed:true,worldAnnotations,states,emitted,ticks,initialGold,paidGold,finalGold:game.players.player.gold,readyHash,launchedHash:await hash(launched),afterLaunch,snapshots:[ready,launched],scope:'Production main renderTrainingProgressButton/helpers extracted verbatim. Tooltip dataset shown in review panel, not live hover/popover; real paid simulation, original training duration and launch rules.'};
}
Object.assign(window,{creatureGameplayProof});
