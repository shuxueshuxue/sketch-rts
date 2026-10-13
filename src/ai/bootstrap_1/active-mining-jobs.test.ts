import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { UNIT_DEFS } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { planMiningWorkforce } from './workforce';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
  (['active', 'ally', 'empty', 'queued'] as const).map(state => ({ race, mirror, state }))))) (
  '$race accounts for the actual $state mining job without a local hall (mirror=$mirror)', ({ race, mirror, state }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('active-unbased-mining-labor').map('bareDuel').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: state === 'ally' ? 'a' : 'b' })
      .townHall('us', x(500), 500, { id: 'home' }).goldMine('depleted', x(788), 500, 0)
      .townHall('foe', x(state === 'ally' ? 2216 : 3500), state === 'ally' ? 1800 : 3500)
      .goldMine('job', x(2000), 1800, state === 'empty' ? 0 : 6000);
    for (let i = 0; i < 4; i++) scene = scene.worker('us', x(1980), 1800 + i * 8,
      { order: { type: 'mine', resourceId: 'job', phase: 'toMine', timer: 0 } });
    const game = scene.build().createGame();
    game.scriptedVictory = true;
    if (state === 'queued') for (let i = 0; i < 2; i++) issuePlayerCommand(game, 'us',
      { type: 'train', buildingId: 'home', unitKind: 'worker' });
    let purchases = 0;
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) for (const command of planMiningWorkforce(snapshotGame(game), 'us', 1, { teams: game.teams })) {
        purchases++; issuePlayerCommand(game, 'us', command);
      }
      stepGame(game);
    }
    expect(purchases).toBe(state === 'active' ? 2 : 0);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'worker')).toHaveLength(state === 'active' || state === 'queued' ? 6 : 4);
    expect(game.match.stats.goldSpent.us).toBe((state === 'active' || state === 'queued' ? 2 : 0) * UNIT_DEFS.worker.cost);
    expect(game.match.stats.unitsLost.us).toBe(0);
    const mined = (state === 'empty' ? 0 : 6000) - game.resources.find(resource => resource.id === 'job')!.amount;
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBeCloseTo(500 + mined, 6);
  }, 30000);
