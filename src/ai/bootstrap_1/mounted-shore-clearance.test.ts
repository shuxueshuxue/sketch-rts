import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapScripts, bootstrapPolicyContext } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror })));

it.each(cases)('$version clears a camp beside its landing ship without damage (mirror=$mirror)', ({ version, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('mounted-shore-clearance').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .goldMine('main', x(716), 500, 10000).goldMine('island', x(3300), 1800, 10000)
    .unit('us', 'horseArcher', x(1200), 2200, { id: 'rider' })
    .unit('us', 'transport', x(2000), 2200, { id: 'ferry' })
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
  const rider = game.units.find(unit => unit.id === 'rider')!, boat = game.units.find(unit => unit.id === 'ferry')!;
  // Ordinary SDK commands arrange the landing; only mountedTasks controls combat afterward.
  issueCommandFrame(game, [
    { playerId: 'us', scriptId: 'scene-boarding', command: { type: 'move', unitIds: [boat.id], x: x(1296), y: 2200 } },
    { playerId: 'us', scriptId: 'scene-boarding', command: { type: 'board', unitIds: [rider.id], transportId: boat.id } },
  ]);
  for (let tick = 0; tick < 4000 && !rider.deck; tick++) stepGame(game);
  expect(rider.deck?.shipId).toBe(boat.id);
  issueCommandFrame(game, [{ playerId: 'us', scriptId: 'scene-landing',
    command: { type: 'unload', unitIds: [boat.id], x: x(2960), y: 1808, avoidCombat: true } }]);
  for (let tick = 0; tick < 4000 && rider.deck; tick++) stepGame(game);
  expect(rider.deck).toBeUndefined();
  const memory = createAiPolicyMemory(), scripts = bootstrapScripts(version).filter(script => script.id === 'mountedTasks');
  let shots = 0, damage = 0;
  game.observer = { hit(attacker, target, taken) {
    if (attacker.id === rider.id) shots++;
    if (target.owner === 'us') damage += taken;
  } };
  for (let tick = 0; tick < 10000 && game.units.some(unit => unit.id.startsWith('guard-')); tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options);
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  expect(game.units.some(unit => unit.id.startsWith('guard-'))).toBe(false);
  expect(game.units.includes(rider) && game.units.includes(boat)).toBe(true);
  expect(rider.hp).toBe(rider.maxHp);
  expect(boat.hp).toBe(boat.maxHp);
  expect(damage).toBe(0);
  expect(shots).toBeGreaterThan(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
}, 60000);
