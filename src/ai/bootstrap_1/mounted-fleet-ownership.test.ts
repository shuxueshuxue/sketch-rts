import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { boardUnit } from '../../shared/decks';
import { hullFits, nearestShipPose } from '../../shared/ship-navigation';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror })));

it.each(cases)('$version keeps a coast battery out of a mounted clearing mission (mirror=$mirror)', ({ version, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('mounted-fleet-ownership').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .building('us', 'shipyard', x(1200), 1000)
    .goldMine('main', x(716), 500, 10000).goldMine('island', x(3300), 1800, 10000)
    .unit('us', 'horseArcher', x(3100), 2100, { id: 'rider' })
    .unit('us', 'warship', x(2864), 1800, { id: 'battery' })
    .unit('us', 'archer', x(2864), 1800, { id: 'gunner' })
    .unit('us', 'priest', x(2864), 1800, { id: 'medic' })
    .unit('neutral', 'redDragon', x(3200), 1750, { id: 'guard-0' })
    .unit('neutral', 'redDragon', x(3200), 1850, { id: 'guard-1' })
    .build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = mirror ? 127 - i % 128 : i % 128;
    return col < 39 || col >= 93 ? '.' : col === 39 || col === 92 ? ',' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const battery = game.units.find(unit => unit.id === 'battery')!;
  const pose = nearestShipPose(game.map, battery, battery)!;
  Object.assign(battery, { x: pose.x, y: pose.y });
  battery.sailing = { heading: pose.heading, speed: 0, load: 0, balance: 0 };
  expect(hullFits(game.map, battery)).toBe(true);
  const crew = game.units.filter(unit => unit.id === 'gunner' || unit.id === 'medic');
  for (const unit of crew) expect(boardUnit(battery, unit, game.units)).toBe(true);
  const memory = createAiPolicyMemory();
  memory.mounted = [{ unitIds: ['rider'], objective: { kind: 'camp', ids: ['guard-0', 'guard-1'] } }];
  const scripts = bootstrapScripts(version).filter(script => ['naval', 'mountedTasks'].includes(script.id));
  let damage = 0, shots = 0;
  game.observer = { hit(attacker, target, taken) {
    if (target.owner === 'us') damage += taken;
    if (attacker.id === 'rider') shots++;
  } };
  for (let tick = 0; tick < 2400; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options)
        .map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  const diagnostic = JSON.stringify({ damage, shots, units: game.units.map(unit => ({ id: unit.id, hp: unit.hp, deck: unit.deck, order: unit.order })) });
  expect(crew.every(unit => game.units.includes(unit) && unit.deck?.shipId === battery.id), diagnostic).toBe(true);
  expect(game.units).toContain(battery);
  expect(damage).toBe(0);
  expect(shots).toBeGreaterThan(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
}, 60000);
