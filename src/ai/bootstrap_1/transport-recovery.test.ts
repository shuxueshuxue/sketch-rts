import { DOCK_REPAIR } from '../../shared/catalog';
import { transportNeedsRecovery } from './transport-recovery';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { shipNeedsRepair, shipPartMax } from '../../shared/ship-equipment';
import { boardUnit } from '../../shared/decks';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror })));

function field(mirror: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('transport-recovery').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .building('us', 'shipyard', x(1200), 1600)
    .goldMine('main', x(716), 500, 10000).goldMine('island', x(3300), 1800, 10000)
    .unit('us', 'horseArcher', x(1200), 2200, { id: 'rider' })
    .unit('us', 'transport', x(2000), 2200, { id: 'ferry', hpRatio: .8 })
    .unit('neutral', 'ogreWarrior', x(3300), 1750, { id: 'guard-0' })
    .unit('neutral', 'ogreWarrior', x(3300), 1850, { id: 'guard-1' })
    .build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = mirror ? 127 - i % 128 : i % 128;
    return col < 39 || col >= 93 ? '.' : col === 39 || col === 92 ? ',' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  stepGame(game);
  return game;
}

it.each(cases)('$version repairs its ferry before the next mounted crossing (mirror=$mirror)', ({ version, mirror }) => {
  const game = field(mirror);
  const boat = game.units.find(unit => unit.id === 'ferry')!, memory = createAiPolicyMemory();
  expect(shipNeedsRepair(game, boat)).toBe(true);
  const initialGold = game.players.us!.gold;
  const scripts = bootstrapScripts(version).filter(script => ['naval', 'mountedTasks'].includes(script.id));
  let dispatched = false;
  for (let tick = 0; tick < 3000 && !dispatched; tick++) {
    if (tick % 15 === 0) {
      const hurt = shipNeedsRepair(game, boat), snapshot = snapshotGame(game);
      const options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options)
        .map(entry => ({ ...entry, playerId: 'us' })));
      if (hurt) expect(memory.naval!.ferries!.ferry).toBeUndefined();
      dispatched = memory.naval!.ferries!.ferry?.purpose === 'creep';
    }
    stepGame(game);
  }
  const diagnostic = JSON.stringify({ boat, memory, gold: game.players.us!.gold, spent: game.match.stats.goldSpent.us });
  expect(dispatched, diagnostic).toBe(true);
  expect(shipNeedsRepair(game, boat)).toBe(false);
  expect(game.match.stats.goldSpent.us).toBeGreaterThan(0);
  expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBe(initialGold);
  expect(game.match.stats.unitsLost.us).toBe(0);
}, 60000);

it.each(cases)('$version finishes the current injured ferry crossing before returning to port (mirror=$mirror)', ({ version, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value, game = field(mirror);
  const boat = game.units.find(unit => unit.id === 'ferry')!, rider = game.units.find(unit => unit.id === 'rider')!;
  expect(boardUnit(boat, rider, game.units)).toBe(true);
  const hp = boat.hp, memory = createAiPolicyMemory();
  memory.naval = { ferries: { ferry: { purpose: 'creep', riderId: rider.id, targetId: 'island',
    from: { x: x(1296), y: 2200 }, to: { x: x(2960), y: 1808 }, phase: 'sailing', crewIds: [], sinceTick: game.tick } } };
  const scripts = bootstrapScripts(version).filter(script => script.id === 'naval');
  for (let tick = 0; tick < 2400 && rider.deck; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options)
        .map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  expect(rider.deck).toBeUndefined();
  expect(game.units).toContain(rider);
  expect(game.units).toContain(boat);
  expect(boat.hp).toBe(hp);
  expect(shipNeedsRepair(game, boat)).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
}, 60000);

it.each(cases)('$version earns maintenance from a operational ferry with unpaid minor repairs (mirror=$mirror)',({version,mirror})=>{
 const game=field(mirror),boat=game.units.find(u=>u.id==='ferry')!,rider=game.units.find(u=>u.id==='rider')!;
 boat.hp=boat.maxHp-DOCK_REPAIR.hpPerSecond;boat.shipParts={...shipPartMax(boat),cabin:shipPartMax(boat).cabin-17};
 game.players.us!.gold=.06;const memory=createAiPolicyMemory();
 const scripts=bootstrapScripts(version).filter(script=>['naval','mountedTasks'].includes(script.id));
 let sailed=false,earned=false;
 for(let tick=0;tick<12000 && (game.units.some(u=>u.id.startsWith('guard-'))||shipNeedsRepair(game,boat));tick++){
  if(tick%15===0){
   const snapshot=snapshotGame(game),options=bootstrapPolicyContext(snapshot,'us',version,{memory,teams:game.teams});
   issueCommandFrame(game,runAiCommandEntriesFromScripts(snapshot,'us',scripts,options).map(e=>({...e,playerId:'us'})));
   sailed ||= memory.naval?.ferries?.ferry?.purpose==='creep';
  }
  stepGame(game);earned ||= game.players.us!.gold>1;
 }
 expect(sailed).toBe(true);expect(earned).toBe(true);
 expect(game.units.some(u=>u.id.startsWith('guard-'))).toBe(false);
 expect(shipNeedsRepair(game,boat)).toBe(false);
 expect(game.match.stats.goldSpent.us).toBeGreaterThan(0);
 expect(game.match.stats.unitsLost.us).toBe(0);
 expect(rider.hp).toBe(rider.maxHp);
},60000);

 it.each(['hull','rigging','rudder'] as const)('keeps an unfunded ferry with substantial %s damage in recovery',part=>{
  const game=field(false),boat=game.units.find(u=>u.id==='ferry')!;
  game.players.us!.gold=.06;boat.hp=boat.maxHp;boat.shipParts={...shipPartMax(boat)};
  if(part==='hull')boat.hp-=DOCK_REPAIR.hpPerSecond+1;
  else boat.shipParts[part]-=1;
  expect(transportNeedsRecovery(snapshotGame(game),boat)).toBe(true);
 });
