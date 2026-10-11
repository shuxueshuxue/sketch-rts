import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => [false, true].map(ambush => ({ version, mirror, ambush }))));

it.each(cases)('$version includes the camp return road in its expedition (mirror=$mirror, ambush=$ambush)',
  ({ version, mirror, ambush }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('camp-return-road').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('ally', { team: 'a' })
      .townHall('us', x(500), 2500).goldMine('main', x(788), 2500, 10000)
      .townHall('ally', x(3500), 3500)
      .unit('neutral', 'wildling', x(1700), 500, { id: 'target' });
    for (let i = 0; i < 8; i++) scene = scene.unit('us', 'footman', x(1600 + i % 4 * 24),
      2400 + Math.floor(i / 4) * 40, { id: `fighter-${i}` });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(670), 2550 + i * 20,
      { id: `miner-${i}`, order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    if (ambush) for (let i = 0; i < 2; i++) scene = scene.unit('neutral', 'redDragon',
      x(1020 + i * 48), 1650 + i * 32, { id: `ambush-${i}` });
    for (let i = 0; i < 16; i++) scene = scene.unit('ally', 'footman', x(3350 + i % 4 * 32),
      3350 + Math.floor(i / 4) * 32, { order: { type: 'hold', x: x(3350 + i % 4 * 32), y: 3350 + Math.floor(i / 4) * 32 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    let guardHits = 0, ambushHits = 0;
    game.observer = { hit(source, target) {
      if (target.id === 'target') guardHits++;
      if (source.id.startsWith('ambush-') && target.owner === 'us') ambushHits++;
    } };
    for (let tick = 0; tick < 2600; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams }));
      stepGame(game);
    }
    expect(ambushHits).toBe(0);
    expect(game.units.filter(unit => unit.id.startsWith('fighter-'))).toHaveLength(8);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
    if (!ambush) {
      expect(guardHits).toBeGreaterThan(0);
      expect(game.units.some(unit => unit.id === 'target')).toBe(false);
    }
  });
