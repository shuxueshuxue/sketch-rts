import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror })))) (
  '$version lets a landed rider clear its island camp without damage (mirror=$mirror)', ({ version, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('mounted-island-expedition').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .goldMine('camp', x(3150), 1600, 6000)
    .unit('us', 'horseArcher', x(2700), 1600, { id: 'rider' });
  for (let index = 0; index < 4; index++) scene = scene.unit('neutral', 'graniteGolem', x(3100 + index % 2 * 45), 1560 + Math.floor(index / 2) * 80, { id: `guard-${index}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return col < 31 || col >= 76 ? '.' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const rider = game.units.find(unit => unit.id === 'rider')!;
  let damage = 0, mountedCommands = 0, arrows = 0;
  game.observer = { hit(source, target, taken) { if (target.id === rider.id) damage += taken; if (source.id === rider.id) arrows++; } };
  for (let tick = 0; tick < 24000 && game.units.includes(rider) && game.units.some(unit => unit.id.startsWith('guard-')); tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
      mountedCommands += entries.filter(entry => entry.scriptId === 'mountedTasks').length;
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  console.log(JSON.stringify({ version, mirror, tick: game.tick, riderAlive: game.units.includes(rider), damage, mountedCommands, arrows,
    remaining: game.units.filter(unit => unit.id.startsWith('guard-')).map(unit => ({ id: unit.id, hp: unit.hp })) }));
  expect(mountedCommands).toBeGreaterThan(0);
  expect(game.units.some(unit => unit.id.startsWith('guard-'))).toBe(false);
  expect(game.units.includes(rider)).toBe(true);
  expect(damage).toBe(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
}, 20000);
