import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => [false, true].map(cliff => ({ version, mirror, cliff }))));

it.each(cases)('$version accounts for road length when deciding whether an assault is near home (mirror=$mirror, cliff=$cliff)',
  ({ version, mirror, cliff }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('near-assault-across-cliff').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500, { id: 'income' }).goldMine('main', x(788), 500, 10000)
      .townHall('foe', x(3500), 3000).townHall('foe', x(1400), 500, { id: 'expansion' })
      .unit('foe', 'footman', x(3500), 3000);
    for (let i = 0; i < 4; i++) scene = scene.unit('us', i < 2 ? 'footman' : 'archer',
      x(650 + i % 2 * 32), 500 + Math.floor(i / 2) * 32, { id: `fighter-${i}` });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(670), 460 + i * 20,
      { id: `miner-${i}`, order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 8; i++) scene = scene.unit('foe', 'footman', x(2800 + i * 32), 500, { id: `raider-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
      const row = Math.floor(i / 128), col = mirror ? 127 - i % 128 : i % 128;
      return cliff && col >= 28 && col <= 30 && row < 100 ? '#' : '.';
    }).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'foe', { type: 'holdPosition',
      unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
    let marches = 0;
    for (let tick = 0; tick < 360; tick++) {
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
      expect(marches).toBe(0);
      expect(Math.max(...gaps)).toBeLessThan(650);
      expect(game.buildings.find(building => building.id === 'expansion')!.hp).toBe(900);
    } else {
      expect(marches).toBeGreaterThan(0);
      expect(game.buildings.find(building => building.id === 'expansion')!.hp).toBeLessThan(900);
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
