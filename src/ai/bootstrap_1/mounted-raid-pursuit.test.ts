import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { UPGRADE_DEFS } from '../../shared/catalog';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { distance } from '../policy/spatial';
import { mountedTasks } from './mounted-tasks';

it.each([false, true])('fights a raid pursuer before it reaches weapon range (mirror=%s)', mirrored => {
  const x = (value: number) => mirrored ? 4096 - value : value;
  let scene = sketchScene('mounted-raid-pursuit').map('openClaims').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
    .townHall('foe', x(3500), 3500, { id: 'raid-hall' }).tower('foe', x(3500), 3300)
    .worker('foe', x(3500), 3350, { id: 'covered-worker' })
    .building('us', 'workshop', x(700), 800, { id: 'research' })
    .unit('us', 'horseArcher', x(1400), 1400, { id: 'rider' })
    .unit('foe', 'witch', x(1900), 1400, { id: 'pursuer' });
  for (let i = 0; i < 5; i++) scene = scene.worker('us', x(600), 480 + i * 25,
    { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
  for (let i = 0; i < 6; i++) scene = scene.building('us', 'farm', x(400 + i * 64), 2600);
  const game = scene.build().createGame(), rider = game.units.find(unit => unit.id === 'rider')!,
    pursuer = game.units.find(unit => unit.id === 'pursuer')!, memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: ['rider'] });
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['pursuer', 'covered-worker'] });
  issuePlayerCommand(game, 'us', { type: 'research', buildingId: 'research', upgradeKind: 'rangeTraining' });
  for (let tick = 0; tick <= UPGRADE_DEFS.rangeTraining.levels[0]!.researchTime; tick++) stepGame(game);
  expect(game.players.us!.upgrades.rangeTraining).toBe(1);
  memory.mounted = [{ unitIds: ['rider'], objective: { kind: 'raid', hallId: 'raid-hall', owner: 'foe' } }];
  issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['pursuer'], targetId: 'rider' });
  let damage = 0, prepared = 0;
  game.observer = { hit(_source, target, taken) { if (target.id === 'rider') damage += taken; } };
  for (let tick = 0; tick < 6000 && game.units.includes(rider) && game.units.includes(pursuer); tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game);
      const entries = planAiOwnerCommandEntries(snapshot,
        { playerId: 'us', version: 'v9_archer', memory, scripts: [mountedTasks] }, { teams: game.teams });
      prepared += entries.filter(entry => entry.command.type === 'aim' && distance(rider, pursuer) > rider.attackRange).length;
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
    }
    stepGame(game);
  }
  expect(game.units).toContain(rider);
  expect(game.units).not.toContain(pursuer);
  expect(prepared).toBeGreaterThan(0);
  expect(damage).toBe(0);
  expect(game.units.some(unit => unit.id === 'covered-worker')).toBe(true);
  expect(game.match.winner).toBeNull();
  expect(game.match.stats.goldSpent.us).toBe(UPGRADE_DEFS.rangeTraining.levels[0]!.cost);
  const mined = 10000 - game.resources[0]!.amount;
  const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
  expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
});
