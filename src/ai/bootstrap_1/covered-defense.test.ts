import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const)
  .flatMap(version => [false, true].map(mirror => ({ version, mirror })));

it.each(cases)('$version holds a reachable tower post while the towers really fire (mirror=$mirror)', ({ version, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('covered-post-control').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .townHall('us', x(600), 1500, { id: 'main' }).townHall('us', x(1600), 1500, { id: 'natural' })
    .goldMine('income', x(1888), 1500, 10000).tower('us', x(1100), 1600, { id: 'tower' })
    .tower('us', x(1000), 1750, { id: 'other-tower' }).townHall('foe', x(3500), 3500);
  for (let index = 0; index < 4; index++) scene = scene.unit('us', 'footman',
    x(1350 + index % 2 * 32), 1400 + Math.floor(index / 2) * 32, { id: `fighter-${index}` });
  for (let index = 0; index < 6; index++) scene = scene.unit('foe', 'sparkArcher',
    x(2000 + index % 2 * 32), 1350 + Math.floor(index / 2) * 32, { id: `raider-${index}` });
  const game = scene.build().createGame(); game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  issuePlayerCommand(game, 'foe', { type: 'attack', targetId: 'main',
    unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
  const memory = createAiPolicyMemory();
  let towerHits = 0, damage = 0, held = 0;
  game.observer = { hit(source, target, amount) {
    if (source.owner === 'us' && !('order' in source)) towerHits++;
    if (target.id.startsWith('fighter-')) damage += amount;
  } };
  for (let tick = 0; tick < 1200; tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
      for (const entry of entries) if (entry.scriptId === 'v6General' && entry.command.type === 'holdPosition') {
        for (const id of entry.command.unitIds) {
          const unit = game.units.find(candidate => candidate.id === id)!;
          expect(game.buildings.some(tower => tower.owner === 'us' && tower.kind === 'defenseTower' && tower.complete
            && Math.hypot(tower.x - unit.x, tower.y - unit.y) <= tower.attackRange)).toBe(true);
          held++;
        }
      }
      issueCommandFrame(game, entries);
    }
    stepGame(game);
  }
  expect(held).toBeGreaterThan(0);
  expect(towerHits).toBeGreaterThan(0);
  expect(game.units.filter(unit => unit.id.startsWith('fighter-'))).toHaveLength(4);
  expect(damage).toBe(0);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
  expect(game.buildings.some(building => building.id === 'main')).toBe(true);
});
