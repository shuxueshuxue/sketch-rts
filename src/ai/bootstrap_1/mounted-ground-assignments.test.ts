import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror }))))(
  '$version assigns an island rider when the first idle rider has no reachable camp (mirror=$mirror)', ({ version, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('mounted-ground-assignments').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .unit('us', 'horseArcher', x(700), 500, { id: 'home-rider' })
    .unit('us', 'horseArcher', x(2850), 1600, { id: 'island-rider' })
    .goldMine('camp', x(3300), 1600, 6000)
    .unit('neutral', 'graniteGolem', x(3300), 1600, { id: 'guard' })
    .build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return col < 31 || col >= 76 ? '.' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const memory = createAiPolicyMemory(), rider = game.units.find(unit => unit.id === 'island-rider')!;
  expect(sameGround(game.map, game.units.find(unit => unit.id === 'home-rider')!, rider)).toBe(false);
  let damage = 0, arrows = 0, assigned = false;
  game.observer = { hit(source, target, taken) { if (target.id === rider.id) damage += taken; if (source.id === rider.id) arrows++; } };
  for (let tick = 0; tick < 1800; tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
      assigned ||= entries.some(entry => entry.scriptId === 'mountedTasks' && 'unitIds' in entry.command && entry.command.unitIds.includes(rider.id));
      issueCommandFrame(game, entries);
    }
    stepGame(game);
  }
  console.log(JSON.stringify({ version, mirror, assigned, arrows, damage, lost: game.match.stats.unitsLost.us }));
  expect(assigned).toBe(true);
  expect(arrows).toBeGreaterThan(0);
  expect(damage).toBe(0);
  expect(game.units.includes(rider)).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => [false, true].map(reinforce => ({ version, mirror, reinforce })))))(
  '$version keeps simultaneous raids on separate reachable land (mirror=$mirror, reinforce=$reinforce)', ({ version, mirror, reinforce }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('mounted-separate-raids').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .townHall('us', x(500), 500)
    .townHall('foe', x(500), 3500, { id: 'home-hall' }).townHall('foe', x(3300), 2400, { id: 'island-hall' })
    .unit('us', 'horseArcher', x(700), 1200, { id: 'home-rider' })
    .unit('us', 'horseArcher', x(2700), 1600, { id: 'island-rider' })
    .worker('foe', x(500), 3200, { id: 'home-worker' }).worker('foe', x(3150), 2150, { id: 'island-worker' });
  if (reinforce) scene = scene.unit('us', 'horseArcher', x(2700), 1550, { id: 'island-recruit' });
  const game = scene.build().createGame();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return col < 31 || col >= 76 ? '.' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const memory = createAiPolicyMemory(), targets = new Set<string>(); let damage = 0;
  if (reinforce) {
    memory.mounted = [
      { unitIds: ['home-rider'], objective: { kind: 'raid', hallId: 'home-hall', owner: 'foe' } },
      { unitIds: ['island-rider'], objective: { kind: 'raid', hallId: 'island-hall', owner: 'foe' } },
    ];
  }
  game.observer = { hit(source, target, taken) { if (source.kind === 'horseArcher') targets.add(target.id); if (target.owner === 'us') damage += taken; } };
  const first = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
  expect(memory.mounted).toEqual([
    { unitIds: ['home-rider'], objective: { kind: 'raid', hallId: 'home-hall', owner: 'foe' } },
    { unitIds: reinforce ? ['island-rider', 'island-recruit'] : ['island-rider'], objective: { kind: 'raid', hallId: 'island-hall', owner: 'foe' } },
  ]);
  issueCommandFrame(game, first);
  for (let tick = 0; tick < 1800 && game.units.some(unit => unit.id.endsWith('-worker')); tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams }));
    stepGame(game);
  }
  expect(targets.has('home-worker')).toBe(true);
  expect(targets.has('island-worker')).toBe(true);
  expect(game.units.some(unit => unit.id.endsWith('-worker'))).toBe(false);
  expect(damage).toBe(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
