/** Review harness exercising the same equipment dialog, commands and simulation as a match. */
import '../../client/styles.css';
import '../../client/battle-hud.css';
import '../../client/game-chrome.css';
import { UnitFacingTracker } from '../../client/unit-facing';
import { EquipmentPanel } from '../../client/equipment-panel';
import { createI18n } from '../../client/i18n';
import { installBakedImage } from '../../client/art/baked-assets';
import { drawWorld, worldLabelsFor } from '../../client/world-renderer';
import { SHIP_KINDS } from '../../shared/ship-geometry';
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
toolbar.style.cssText = 'position:fixed;bottom:12px;left:20px;display:flex;gap:6px;flex-wrap:wrap;color:#b5beac;font:12px system-ui;align-items:center;z-index:90';
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
for (const [label, action] of [['人物装备', () => panel.show([archer])], ['船舱与炮位', () => panel.show([ship])], ['喷火舰',()=>panel.show([fireShip])],['快艇',()=>panel.show([cutter])],['大型战舰',()=>panel.show([carrier])],
    ...[['宽屏',undefined,undefined],['窄屏',390,560],['横屏',760,420],['小窗',350,360]].map(([label,width,height])=>[label as string,()=>{panel.root.style.width=width?`${width}px`:'';panel.root.style.height=height?`${height}px`:'';}] as const),
    ['重新开始', () => location.reload()]] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'equipment-action';
    button.addEventListener('click', action);
    toolbar.append(button);
}
const note = document.createElement('span');
note.textContent = '拖拽 / 双击转移 · 火炮占四格 · 不影响线上对局';
toolbar.append(note);
void Promise.all(SHIP_KINDS.flatMap(kind => ['base', 'upper', 'depth', ...(['warship', 'bombardShip', 'fireShip'].includes(kind) ? ['weapon', 'weapon-depth'] : [])].map(layer => new Promise<void>(resolve => { const image = new Image(); image.onload = () => { installBakedImage(`ships/${kind}-${layer}`, image); resolve(); }; image.onerror = () => resolve(); image.src = `/sketch-rts/art/ships/${kind}-${layer}.png`; }))));
panel.update(snapshotGame(game), 'player');
panel.show([unit, ship]);
function tick() { stepGame(game); const snapshot = snapshotGame(game); panel.update(snapshot, 'player'); const context = canvas.getContext('2d')!; context.clearRect(0, 0, canvas.width, canvas.height); drawWorld({ ctx: context, snapshot, view: { x: 300, y: 300, width: canvas.width, height: canvas.height, zoom: 1 }, facing: new UnitFacingTracker(), selectedIds: new Set([unit.id, ship.id]), viewer: 'player', now: performance.now(), labels: worldLabelsFor(i18n) }); }
setInterval(tick, 50);
