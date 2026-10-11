import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => [false, true].map(cliff => ({ version, mirror, cliff }))));

it.each(cases)('$version accounts for roads to its income during a march (mirror=$mirror, cliff=$cliff)',
  ({ version, mirror, cliff }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('march-income-risk').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' }).player('raid', { team: 'b' })
      .townHall('us', x(500), 800, { id: 'income' }).goldMine('main', x(788), 800, 10000)
      .townHall('foe', x(3500), 3500).townHall('foe', x(3500), 800, { id: 'expansion' })
      .townHall('raid', x(500), 3500).unit('foe', 'footman', x(3500), 3450);
    for (let i = 0; i < 4; i++) scene = scene.unit('us', i < 2 ? 'footman' : 'archer',
      x(800 + i % 2 * 32), 800 + Math.floor(i / 2) * 32, { id: `fighter-${i}` });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(670), 760 + i * 20,
      { id: `miner-${i}`, order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 4; i++) scene = scene.unit('raid', 'knight', x(500 + i * 32), 2900, { id: `raider-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
      const row = Math.floor(i / 128), col = mirror ? 127 - i % 128 : i % 128;
      return cliff && row >= 48 && row <= 50 && col < 90 ? '#' : '.';
    }).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'raid', { type: 'holdPosition',
      unitIds: ['raider-0', 'raider-1', 'raider-2', 'raider-3'] });
    let marches = 0;
    for (let tick = 0; tick < 300; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game),
          { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
        if (memory.v6?.general?.mode === 'attack') marches++;
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    const hall = game.buildings.find(building => building.id === 'income')!;
    const fighters = game.units.filter(unit => unit.id.startsWith('fighter-'));
    const gaps = fighters.map(unit => Math.hypot(unit.x - hall.x, unit.y - hall.y));
    if (cliff) {
      expect(marches).toBeGreaterThan(0);
      expect(Math.min(...gaps)).toBeGreaterThan(750);
    } else {
      expect(marches).toBe(0);
      expect(Math.max(...gaps)).toBeLessThan(650);
    }
    expect(fighters).toHaveLength(4);
    expect(fighters.every(unit => unit.hp === unit.maxHp)).toBe(true);
    expect(game.units.filter(unit => unit.id.startsWith('miner-'))).toHaveLength(5);
    expect(game.match.stats.goldSpent.us).toBe(0);
    const mined = 10000 - game.resources[0]!.amount;
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(mined).toBeGreaterThan(0);
    expect(game.players.us!.gold + carried).toBe(500 + mined);
  });
