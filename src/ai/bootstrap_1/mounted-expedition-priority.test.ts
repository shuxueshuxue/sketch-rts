import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => (['boarding', 'healing', 'reservedCrew'] as const).map(task => ({ version, mirror, task }))));

it.each(cases)('$version keeps island rider $task ahead of mounted tasks (mirror=$mirror)', ({ version, mirror, task }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('mounted-island-priority').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500, { id: 'foe-hall' })
    .goldMine('camp', x(3150), 1600, 6000)
    .unit('us', 'horseArcher', x(2700), 1600, { id: 'rider', ...(task === 'healing' ? { hp: 20 } : {}) })
    .unit('neutral', 'graniteGolem', x(3150), 1600, { id: 'guard' });
  scene = task === 'healing' ? scene.unit('us', 'priest', x(2530), 1600, { id: 'healer' })
    : scene.unit('us', 'transport', x(1800), 1600, { id: 'ferry' });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return col < 31 || col >= 76 ? '.' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  if (task !== 'healing') stepGame(game);
  const rider = game.units.find(unit => unit.id === 'rider')!;
  memory.mounted = [{ unitIds: ['rider'], objective: { kind: 'camp', ids: ['guard'] } }];
  if (task === 'boarding') issuePlayerCommand(game, 'us', { type: 'board', unitIds: ['rider'], transportId: 'ferry' });
  if (task === 'reservedCrew') memory.naval = { ferries: { ferry: {
    purpose: 'assault', targetId: 'foe-hall', phase: 'loading', from: { x: x(2500), y: 1600 },
    to: { x: x(900), y: 3500 }, crewIds: ['rider'], sinceTick: game.tick,
  } } };
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
  expect(entries.some(entry => entry.scriptId === 'mountedTasks' && 'unitIds' in entry.command && entry.command.unitIds.includes(rider.id))).toBe(false);
  issueCommandFrame(game, entries);
  const beforeX = rider.x;
  for (let tick = 0; tick < 30; tick++) stepGame(game);
  expect(game.units.includes(rider)).toBe(true);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
  if (task === 'healing') {
    expect(entries.some(entry => entry.scriptId === 'naval' && entry.command.type === 'follow' && entry.command.unitIds.includes(rider.id))).toBe(true);
    expect(rider.hp).toBeGreaterThan(20);
    expect(Math.abs(rider.x - x(2530))).toBeLessThan(Math.abs(beforeX - x(2530)));
  } else if (task === 'boarding') {
    expect(rider.order).toMatchObject({ type: 'board', transportId: 'ferry' });
    expect(Math.abs(rider.x - x(1800))).toBeLessThan(Math.abs(beforeX - x(1800)));
  } else {
    expect(rider.order.type).toBe('idle');
    expect(memory.naval!.ferries!.ferry!.crewIds).toContain(rider.id);
    expect(game.units.find(unit => unit.id === 'ferry')!.order.type).toBe('move');
  }
});
