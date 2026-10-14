/** Real paid/blocked simulation plus production main button subset, not full app UI. */
import {createGame,issuePlayerCommand,stepGame,snapshotGame} from '/@fs/tmp/sketch-creature-review-before-de3/src/shared/sim.ts';
import {createBuilding,createUnit} from '/@fs/tmp/sketch-creature-review-before-de3/src/shared/map.ts';
import * as training from '/@fs/tmp/sketch-creature-review-before-de3/src/client/training-queue.ts';
import {createI18n} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/i18n.ts';
import {TRAINABLE_UNIT_KINDS} from '/@fs/tmp/sketch-creature-review-before-de3/src/shared/catalog.ts';
import {TRAINED_UNIT_CARDS} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/content/units.ts';
import {unitTooltip,formatTooltipDataset} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/tooltips.ts';
import {drawAtlasUnitPortrait,drawAtlasBuildingPortrait} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/atlas-art.ts';
import {ownerInk} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/world-renderer.ts';
import {appearanceForKind,appearanceKey} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/art/unit-appearance.ts';
import {paintPortrait} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/portrait-cache.ts';
import {worldModels} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/world3d/model-library.ts';
import {activateModelPortraits} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/world3d/model-portraits.ts';
import {resources} from '/@fs/tmp/sketch-creature-review-before-de3/src/client/resources.ts';
import '/@fs/tmp/sketch-creature-review-before-de3/src/client/battle-hud.css';
let i18n=createI18n('zh');const t=(...args:any[])=>(i18n.t as any)(...args),tl=(kind:any)=>i18n.label(kind);
const localPlayerId='player',TRAIN_COMMANDS=TRAINABLE_UNIT_KINDS.map(kind=>({kind,...TRAINED_UNIT_CARDS[kind].command}));
const trainingProgressText=(training as any).trainingProgressText;
let snapshot:any;const currentPlayerState=()=>snapshot.players.player;
const emitted:any[]=[];const sendCommand=(command:any)=>emitted.push(command);
function renderTrainingProgressButton(progress: TrainingProgressButton, previous?: HTMLButtonElement) {
  const percent = Math.floor(progress.progress * 100);
  const label = t(progress.status === "training" ? "hud.trainingTraining" : "hud.trainingQueued", { label: labelKind(progress.unitKind) });
  const button = previous ?? document.createElement("button");
  button.type = "button";
  button.tabIndex = -1;
  button.className = "command-button research-progress-button";
  button.classList.add("training-cancel-button");
  button.disabled = !progress.jobId;
  if (!previous) button.addEventListener("click", () => {
    if (progress.jobId) sendCommand({ type: "cancelTraining", buildingId: progress.buildingId, jobId: progress.jobId });
  });
  if (progress.jobId) button.dataset.jobId = progress.jobId;
  button.dataset.trainingProgress = progress.unitKind;
  button.dataset.commandLabel = label;
  button.setAttribute("aria-label", `${label} - ${percent}%`);
  const tooltip = unitTooltip(progress.unitKind, undefined, i18n, currentPlayerState()?.race);
  applyTooltip(button, {
    ...tooltip,
    title: `${label} · ${t("hud.cancelTraining")}`,
    stats: [t("hud.progressComplete", { percent }), ...tooltip.stats],
  });
  button.style.setProperty("--research-progress", `${percent}%`);
  if (!previous) button.innerHTML = `
    <span class="research-progress-fill"></span>
    <span class="command-icon">${escapeHtml(trainIcon(progress.unitKind))}</span>
    <span class="command-label">${escapeHtml(labelKind(progress.unitKind))}</span>
    <span class="research-progress-text"></span>
  `;
  drawCommandPortrait(button, { type: "unit", kind: progress.unitKind });
  button.querySelector(".research-progress-text")!.textContent = progress.status === "training" ? `${percent}%` : t("hud.productionQueueBadge");
  return button;
}
function drawCommandPortrait(element: HTMLElement, portrait: CommandPortrait) {
  const icon = element.querySelector<HTMLCanvasElement>('canvas.command-portrait') ?? document.createElement("canvas");
  if(!icon.classList.contains('command-portrait')){
    icon.width = icon.height = 96;
    icon.className = "command-portrait";
    icon.setAttribute("aria-hidden", "true");
    element.querySelector(".command-icon, .item-icon")?.replaceChildren(icon);
  }
  const color=ownerInk(localPlayerId,snapshot??undefined);
  const appearance=portrait.type === "unit" ? appearanceForKind(portrait.kind,currentPlayerState()?.race) : {};
  paintPortrait(icon,`${portrait.type}:${portrait.kind}:${portrait.type==='item'?portrait.weaponKind??'':''}:${color}:${appearanceKey(appearance)}`,()=>{
    const brush = requireCanvasContext(icon);
    const size=icon.clientWidth||icon.width;
    const center = { x: size/2, y: size/2 };
    if (portrait.type === "unit") drawAtlasUnitPortrait(brush, portrait.kind, 0, 0, size, color, appearance);
    else if (portrait.type === "item") drawPaintedItem(brush, portrait.kind, center, size*.8,false,portrait.weaponKind);
    else drawAtlasBuildingPortrait(brush, portrait.kind, size, color);
  });
}
function applyTooltip(element: HTMLElement, tooltip: GameplayTooltip) {
  const dataset = formatTooltipDataset(tooltip);
  element.dataset.tooltipTitle = dataset.title;
  element.dataset.tooltipBody = dataset.body;
  element.dataset.tooltipStats = dataset.stats;
  element.dataset.tooltipRequirements = dataset.requirements;
  element.dataset.tooltipNotes = dataset.notes;
  element.dataset.tooltipHotkey = dataset.hotkey;
}
function trainIcon(kind: TrainableUnitKind) {
  return TRAIN_COMMANDS.find((command) => command.kind === kind)?.icon ?? "△";
}
function labelKind(kind: BuildingKind | TrainableUnitKind | AbilityKind | UpgradeKind | WorldItem["kind"] | string) {
  return tl(kind as LabelKey);
}
function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function requireCanvasContext(target: HTMLCanvasElement) {
  const context = target.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  return context;
}
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
 await resources.initialize();await worldModels.prepare(['ships/transport'],'home');activateModelPortraits();
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
 must(emitted.length===2&&emitted.every(c=>c.type==='cancelTraining'&&c.jobId===ready.buildings.find((b:any)=>b.id==='dock').queue[0].id),'Cancel callback changed');
 return{passed:true,states,emitted,ticks,initialGold,paidGold,finalGold:game.players.player.gold,readyHash,launchedHash:await hash(launched),afterLaunch,snapshots:[ready,launched],scope:'Production main renderTrainingProgressButton/helpers extracted verbatim. Tooltip dataset shown in review panel, not live hover/popover; real paid simulation, original training duration and launch rules.'};
}
Object.assign(window,{creatureGameplayProof});
