import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint, walkingDistance } from '../../shared/terrain';
import { UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => [false, true].map(cliff => ({ version, mirror, cliff }))));

it.each(cases)('$version compares both sides by road before voluntary creeping (mirror=$mirror, cliff=$cliff)',
  ({ version, mirror, cliff }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('camp-side-across-cliff').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500, { id: 'income' }).goldMine('main', x(788), 500, 10000)
      .townHall('foe', x(3500), 3500, { id: 'enemy-home' })
      .unit('neutral', 'wildling', x(1400), 500, { id: 'target-guard' });
    for (let i = 0; i < 8; i++) scene = scene.unit('us', 'footman',
      x(600 + i % 4 * 24), 470 + Math.floor(i / 4) * 40, { id: `fighter-${i}` });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(670), 550 + i * 20,
      { id: `miner-${i}`, order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 16; i++) scene = scene.unit('foe', 'footman', x(3350 + i % 4 * 32),
      3350 + Math.floor(i / 4) * 32, { order: { type: 'hold', x: x(3350 + i % 4 * 32), y: 3350 + Math.floor(i / 4) * 32 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
      const row = Math.floor(i / 128), col = mirror ? 127 - i % 128 : i % 128;
      return cliff && col >= 28 && col <= 30 && row < 100 ? '#' : '.';
    }).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const own = game.buildings.find(b => b.id === 'income')!, enemy = game.buildings.find(b => b.id === 'enemy-home')!;
    const guard = game.units.find(unit => unit.id === 'target-guard')!;
    expect(Math.hypot(own.x - guard.x, own.y - guard.y)).toBeLessThan(Math.hypot(enemy.x - guard.x, enemy.y - guard.y));
    expect(walkingDistance(game.map, own, guard, 'land')! > walkingDistance(game.map, enemy, guard, 'land')!).toBe(cliff);
    let creepTurns = 0, guardDamage = 0;
    game.observer = { hit(_source, target, damage) { if (target.id === guard.id) guardDamage += damage; } };
    for (let tick = 0; tick < 600; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game),
          { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
        if (memory.v6?.general?.mode === 'creep') creepTurns++;
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    if (cliff) {
      expect(creepTurns).toBe(0);
      expect(guardDamage).toBe(0);
      expect(game.units.filter(unit => unit.id.startsWith('fighter-')).every(unit =>
        Math.hypot(unit.x - own.x, unit.y - own.y) < 650)).toBe(true);
    } else {
      expect(creepTurns).toBeGreaterThan(0);
      expect(guardDamage).toBeGreaterThan(0);
      expect(game.units.some(unit => unit.id === guard.id)).toBe(false);
    }
    expect(game.units.filter(unit => unit.id.startsWith('fighter-'))).toHaveLength(8);
    expect(game.units.filter(unit => unit.id.startsWith('miner-'))).toHaveLength(5);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
    const mined = 10000 - game.resources[0]!.amount;
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(mined).toBeGreaterThan(0);
    expect(game.players.us!.gold + carried).toBe(500 + mined + (cliff ? 0 : UNIT_DEFS.wildling.goldBounty!));
  });
