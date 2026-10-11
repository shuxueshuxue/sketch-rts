import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => [false, true].map(free => ({ version, mirror, free }))));

it.each(cases)('$version occupies a free sixth mine and respects allied ownership (mirror=$mirror, free=$free)',
  ({ version, mirror, free }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('sixth-working-mine').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('ally', { race: 'grove', team: 'a' })
      .townHall('ally', x(3500), 3500).goldMine('ally-mine', x(3788), 3500, 10000)
      .farms('us', 12, x(300), 2500);
    const halls = [[500, 500], [1400, 500], [2300, 500], [500, 1400], [1400, 1400]];
    for (const [index, [hx, hy]] of halls.entries()) {
      scene = scene.townHall('us', x(hx!), hy!, { id: `income-${index}` })
        .goldMine(`mine-${index}`, x(hx! + 288), hy!, 10000);
      for (let i = 0; i < 5; i++) scene = scene.worker('us', x(hx! + 160), hy! + i * 25,
        { id: `miner-${index}-${i}`, order: { type: 'mine', resourceId: `mine-${index}`, phase: 'toMine', timer: 0 } });
    }
    if (free) scene = scene.goldMine('free-mine', x(2588), 1400, 10000);
    const kind = version === 'v9_archer' ? 'archer' : version === 'v9_summoner' ? 'summoner' : 'knight';
    for (let i = 0; i < 26; i++) scene = scene.unit('us', kind, x(2240 + i % 5 * 24),
      1200 + Math.floor(i / 5) * 24, { id: `fighter-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    memory.v6 = { phase: 3 };
    const starting = new Set(game.units.filter(unit => unit.owner === 'us').map(unit => unit.id));
    let ownBuilds = 0, alliedBuilds = 0;
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory }, { teams: game.teams });
        for (const entry of entries) if (entry.command.type === 'build' && entry.command.buildingKind === 'townHall') {
          if (Math.hypot(entry.command.x - x(2588), entry.command.y - 1400) <= 600) ownBuilds++;
          if (Math.hypot(entry.command.x - x(3788), entry.command.y - 3500) <= 600) alliedBuilds++;
        }
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    const own = game.buildings.filter(b => b.owner === 'us' && b.kind === 'townHall');
    expect(alliedBuilds).toBe(0);
    expect(own).toHaveLength(free ? 6 : 5);
    if (free) {
      expect(ownBuilds).toBeGreaterThan(0);
      expect(own.every(b => b.complete)).toBe(true);
      expect(game.resources.find(m => m.id === 'free-mine')!.amount).toBeLessThan(10000);
      expect(game.match.stats.goldSpent.us!).toBeGreaterThanOrEqual(400);
    } else expect(ownBuilds).toBe(0);
    expect(game.units.filter(unit => starting.has(unit.id))).toHaveLength(starting.size);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.resources.find(m => m.id === 'ally-mine')!.amount).toBe(10000);
  });
