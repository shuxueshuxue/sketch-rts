import {commandIconMarkup} from '../../client/command-icons';
import {WorldPresentation} from '../../client/world-presentation';
/** Review harness exercising the same equipment dialog, commands and simulation as a match. */
import '../../client/styles.css';
import '../../client/battle-hud.css';
import '../../client/game-chrome.css';
import '../../client/game-ui.css';
import { UnitFacingTracker } from '../../client/unit-facing';
import { EquipmentPanel } from '../../client/equipment-panel';
import {BattleHudSelection} from '../../client/battle-hud';
import {drawAtlasUnitPortrait} from '../../client/atlas-art';
import { createI18n } from '../../client/i18n';
import { drawWorld, worldLabelsFor } from '../../client/world-renderer';
import { shipPassengers } from '../../shared/ship-geometry';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { boardUnit, deckPlacement, syncDecks } from '../../shared/decks';
import { shipItemMass } from '../../shared/equipment';
import { shipPartMax } from '../../shared/ship-equipment';
import type { ItemKind, WorldItem } from '../../shared/types';
const game = createGame('bareDuel', { aiPlayers: [], scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, replaceDefaultLandmarks: true } });
game.scriptedVictory = true;
delete game.map.terrain;
game.map.width = 1800;
game.map.height = 1400;
game.players.player!.gold = 3000;
const ship = game.spawnUnit('player', 'transport', 900, 750), unit = game.spawnUnit('player', 'footman', 900, 750);
const archer = game.spawnUnit('player','archer',500,700);
game.items.push({ id: 'archer-boots', kind: 'speedBoots', x: archer.x, y: archer.y, cooldownRemaining: 0 });
issuePlayerCommand(game,'player',{type:'pickupItem',unitId:archer.id,itemId:'archer-boots'});
boardUnit(ship, unit, game.units);
for(const [kind,x,y] of [['worker',-45,-15],['archer',25,18]] as const){const crew=game.spawnUnit('player',kind,900,750);boardUnit(ship,crew,game.units);const at=deckPlacement(ship,crew,game.units,{x,y});if(at)crew.deck={shipId:ship.id,...at};}
unit.deck = { shipId: ship.id, ...deckPlacement(ship, unit, game.units, { x: -8, y: 18 })! };
syncDecks(game.units);
for (const kind of ['greatSword', 'roundShield', 'healingScroll', 'regenRing', 'leatherArmor', 'speedBoots'] as ItemKind[]) {
    const item: WorldItem = { id: `preview-${kind}`, kind, x: unit.x, y: unit.y, cooldownRemaining: 0 };
    game.items.push(item);
    issuePlayerCommand(game, 'player', { type: 'pickupItem', unitId: unit.id, itemId: item.id });
}
issuePlayerCommand(game, 'player', { type: 'wieldItem', unitId: unit.id, itemId: 'preview-roundShield', hand: 'left' });
for (const [kind, holdSlot] of [['shipCannon', 0], ['flameProjector', 4], ['lightningRod', 8], ['experienceBook', 9], ['guardianScroll', 10]] as const)
    game.items.push({ id: `stored-${kind}`, kind, shipId: ship.id, holdSlot, x: ship.x, y: ship.y, durability: kind === 'shipCannon' ? 27 : kind === 'flameProjector' ? 0 : undefined, cooldownRemaining: 0 } as WorldItem);
const cutter = game.spawnUnit('player', 'cutter', 1080, 750), carrier = game.spawnUnit('player', 'carrier', 1150, 1050);
const fireShip=game.spawnUnit('player','fireShip',750,1050);
cutter.order = { type: 'hold', x: cutter.x, y: cutter.y };
carrier.order = { type: 'hold', x: carrier.x, y: carrier.y };
ship.holdMass = shipItemMass(game, ship);
syncDecks(game.units);
const parts = shipPartMax(ship);
ship.shipParts = { rigging: parts.rigging, rudder: parts.rudder };
const i18n = createI18n('zh');
const canvas = document.createElement('canvas');
canvas.width = 1280;
canvas.height = 860;
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;opacity:.7';
document.body.append(canvas);
const heading = document.createElement('div');
heading.style.cssText = 'position:fixed;top:15px;left:20px;color:#b5beac;font:12px system-ui';
heading.textContent = 'Sketch RTS · 装备与船舱交互试玩';
document.body.append(heading);
const toolbar = document.createElement('div');
toolbar.style.cssText = 'position:fixed;top:42px;left:20px;display:flex;gap:6px;flex-wrap:wrap;color:#b5beac;font:12px system-ui;align-items:center;z-index:90';
document.body.append(toolbar);
const panel = new EquipmentPanel(() => i18n, command => { try {
    issuePlayerCommand(game, 'player', command);
    panel.update(snapshotGame(game), 'player');
}
catch (error) {
    const feedback = panel.root.querySelector<HTMLElement>('[data-equipment-feedback]');
    if (feedback) {
        feedback.textContent = error instanceof Error ? error.message : String(error);
        feedback.classList.add('invalid');
    }
} });
let portraitShip=ship;
const showShip=(vessel:typeof ship)=>{portraitShip=vessel;panel.show([vessel]);};
const hudFrame=document.createElement('div');hudFrame.className='game-shell';hudFrame.style.cssText='position:fixed;inset:0;pointer-events:none;background:transparent';
const hudDeck=document.createElement('div');hudDeck.className='control-deck';hudDeck.style.pointerEvents='auto';
const hudCard=document.createElement('div');hudCard.className='selection-chip';hudDeck.append(hudCard);hudFrame.append(hudDeck);document.body.append(hudFrame);
const hud=new BattleHudSelection(hudCard,'船员');
const actions=document.createElement('div');actions.className='hud-actions';const commands=document.createElement('div');commands.className='command-dock';actions.append(commands);hudDeck.append(actions);
for(const [label,icon,key,run] of [['装备','▣','I',()=>showShip(portraitShip)],['攻击','⚔','A',()=>{}],['停止','▥','S',()=>{}]] as const){
 const button=document.createElement('button');button.className='command-button';button.innerHTML=`<span class="command-icon">${commandIconMarkup(icon)}</span><span class="command-label">${label}</span><span class="hotkey">${key}</span>`;button.addEventListener('click',run);commands.append(button);
}

function updatePortraits(){
  const art=(kind:typeof ship.kind)=>({key:kind,paint:(target:HTMLCanvasElement)=>drawAtlasUnitPortrait(target.getContext('2d')!,kind,0,0,target.clientWidth,'#819b82')});
  hud.render({key:portraitShip.id,name:i18n.label(portraitShip.kind),caption:'己方船只',detail:'甲板布阵 · 船舱装备',art:art(portraitShip.kind),health:{current:portraitShip.hp,max:portraitShip.maxHp}},[],'',[{key:portraitShip.id,label:'船员',passengers:shipPassengers(game.units,portraitShip).map(crew=>({key:crew.id,name:i18n.label(crew.kind),actionLabel:`卸载 ${i18n.label(crew.kind)}`,art:art(crew.kind),health:{current:crew.hp,max:crew.maxHp},activate:()=>{try{issuePlayerCommand(game,'player',{type:'unloadPassenger',transportId:portraitShip.id,passengerId:crew.id});}catch(error){note.textContent=String(error);}},decorate:()=>{}}))}]);
}
for (const [label, action] of [['人物装备', () => panel.show([archer])], ['船舱与炮位', () => showShip(ship)], ['喷火舰',()=>showShip(fireShip)],['快艇',()=>showShip(cutter)],['大型战舰',()=>showShip(carrier)],['检查船头像',()=>panel.close()],
    ...[['宽屏',undefined,undefined],['窄屏',390,560],['横屏',760,420],['小窗',350,360]].map(([label,width,height])=>[label as string,()=>{panel.root.style.width=width?`${width}px`:'';panel.root.style.height=height?`${height}px`:'';}] as const),
    ['重新开始', () => location.reload()]] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'equipment-action';
    button.addEventListener('click', action);
    toolbar.append(button);
}
const lockMode=document.createElement('button');lockMode.className='equipment-action';lockMode.textContent='锁定鼠标测试';toolbar.append(lockMode);
let lockedAt={x:680,y:470};
lockMode.addEventListener('click',()=>{void canvas.requestPointerLock();});
const cursor=document.createElement('span');cursor.style.cssText='position:fixed;width:12px;height:12px;border:1px solid white;border-radius:50%;pointer-events:none;z-index:200;display:none';document.body.append(cursor);
document.addEventListener('pointerlockchange',()=>{cursor.style.display=document.pointerLockElement?'block':'none';});
document.addEventListener('mousemove',event=>{if(document.pointerLockElement!==canvas)return;lockedAt={x:Math.max(0,Math.min(innerWidth,lockedAt.x+event.movementX)),y:Math.max(0,Math.min(innerHeight,lockedAt.y+event.movementY))};cursor.style.left=`${lockedAt.x}px`;cursor.style.top=`${lockedAt.y}px`;panel.virtualPointer('pointermove',lockedAt,event.buttons,event);});
for(const type of ['mousedown','mouseup'] as const)document.addEventListener(type,event=>{if(document.pointerLockElement===canvas&&event.button===0)panel.virtualPointer(type==='mousedown'?'pointerdown':'pointerup',lockedAt,event.buttons,event);});
const note = document.createElement('span');
note.textContent = '拖拽 / 双击转移 · 火炮占四格 · 不影响线上对局';
toolbar.append(note);
const presentation=new WorldPresentation(canvas);void presentation.prepare(snapshotGame(game),'match');
panel.update(snapshotGame(game), 'player');
panel.show([unit, ship]);
function tick() { stepGame(game); const snapshot = snapshotGame(game); panel.update(snapshot, 'player'); updatePortraits(); const context = canvas.getContext('2d')!; context.clearRect(0, 0, canvas.width, canvas.height); presentation.draw({ ctx: context, snapshot, view: { x: 300, y: 300, width: canvas.width, height: canvas.height, zoom: 1 }, facing: new UnitFacingTracker(), selectedIds: new Set([unit.id, ship.id]), viewer: 'player', now: performance.now(), labels: worldLabelsFor(i18n) }); }
setInterval(tick, 50);
