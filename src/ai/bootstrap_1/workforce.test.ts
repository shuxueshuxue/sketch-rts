import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { UNIT_DEFS } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { planMiningWorkforce } from './workforce';

describe('bootstrap_1 mining workforce', () => {
  it('trains the next mine crew before its hall finishes, using ordinary gold, supply and queues', () => {
    let scene = sketchScene('crew-before-hall').replaceDefaults()
      .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 1000 })
      .townHall('foe', 2800, 2800)
      .townHall('us', 500, 500, { id: 'main' }).goldMine('main-mine', 788, 500, 4000)
      .townHall('us', 1400, 500, { id: 'natural', complete: false }).goldMine('natural-mine', 1688, 500, 4000)
      .farms('us', 1, 500, 850);
    for (let index = 0; index < 6; index++) scene = scene.worker('us', 520 + index * 35, 600);
    const game = scene.build().createGame();
    let trained = 0;
    for (let tick = 0; tick < 1000; tick++) {
      if (tick % 15 === 0) for (const command of planMiningWorkforce(snapshotGame(game), 'us')) {
        issuePlayerCommand(game, 'us', command);
        trained++;
      }
      stepGame(game);
    }
    expect(trained).toBe(5);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'worker')).toHaveLength(11);
    expect(game.players.us!.gold).toBe(1000 - 5 * UNIT_DEFS.worker.cost);
    expect(game.players.us!.supplyUsed).toBe(11);
    expect(game.buildings.find(building => building.id === 'main')!.queue).toHaveLength(0);
  });
});
