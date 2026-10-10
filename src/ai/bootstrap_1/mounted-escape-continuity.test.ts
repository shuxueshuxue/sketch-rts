import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { UPGRADE_DEFS } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { mountedEscape } from './mounted-micro';

it.each([0, 1].flatMap(level => [false, true].map(mirror => ({ level, mirror }))))(
  'keeps a rider faster than a pursuing runner through ordinary movement (speed=$level, mirror=$mirror)', ({ level, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('mounted-escape-continuity').map('openClaims').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .building('us', 'stables', x(800), 500, { id: 'our-lab' })
      .building('foe', 'cinderSpire', x(3200), 3500, { id: 'their-lab' })
      .unit('us', 'horseArcher', x(600), 2000, { id: 'rider' })
      .unit('foe', 'cinderRunner', x(500), 2000, { id: 'runner' }).build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    const rider = game.units.find(unit => unit.id === 'rider')!, runner = game.units.find(unit => unit.id === 'runner')!;
    issuePlayerCommand(game, 'us', { type: 'aim', unitIds: ['rider'], x: x(600), y: 0 });
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['runner'] });
    if (level) {
      issuePlayerCommand(game, 'us', { type: 'research', buildingId: 'our-lab', upgradeKind: 'speedTraining' });
      issuePlayerCommand(game, 'foe', { type: 'research', buildingId: 'their-lab', upgradeKind: 'speedTraining' });
      for (let tick = 0; tick <= UPGRADE_DEFS.speedTraining.levels[0]!.researchTime; tick++) stepGame(game);
    }
    expect(rider.speed).toBeGreaterThan(runner.speed);
    issuePlayerCommand(game, 'foe', { type: 'setStance', unitIds: ['runner'], stance: 'shock' });
    issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['runner'], targetId: 'rider' });
    let damage = 0, traveled = 0;
    game.observer = { hit(_source, target, amount) { if (target.id === rider.id) damage += amount; } };
    for (let tick = 0; tick < 600; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, [{ playerId: 'us', scriptId: 'mountedTasks',
        command: mountedEscape(snapshotGame(game), rider, [runner], 0, undefined) }]);
      const from = { x: rider.x, y: rider.y };
      stepGame(game);
      traveled += Math.hypot(rider.x - from.x, rider.y - from.y);
    }
    expect(game.units).toContain(rider);
    expect(rider.hp).toBe(rider.maxHp);
    expect(damage).toBe(0);
    expect(traveled).toBeGreaterThanOrEqual(rider.speed * 30 - 1);
    for (const owner of ['us', 'foe']) {
      const cost = level * UPGRADE_DEFS.speedTraining.levels[0]!.cost;
      expect(game.match.stats.goldSpent[owner]).toBe(cost);
      expect(game.players[owner]!.gold).toBe(500 - cost);
    }
    expect(game.match.winner).toBeNull();
  }, 30000);
