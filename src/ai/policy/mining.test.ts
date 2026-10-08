import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createBuilding } from '../../shared/map';
import { seconds } from '../../shared/time';
import { AI_SCRIPT_LIBRARY } from './core';

describe('mining workforce after admission', () => {
  it.each(['v5', 'v7', 'v8'] as const)('%s moves surplus miners to a new base even after every worker has entered the old mine', version => {
    const game = createGame('bareDuel', {aiPlayers: []});
    game.units = [];
    game.scriptedVictory = true;
    const main = game.resources.find(mine => mine.id === 'gold-player-main')!;
    const workers = Array.from({length: 8}, (_, i) => game.spawnUnit('player', 'worker', main.x, main.y + i));
    issuePlayerCommand(game, 'player', {type: 'mine', unitIds: workers.map(worker => worker.id), resourceId: main.id});
    for (let tick = 0; tick < seconds(30); tick++) stepGame(game);
    expect(workers.every(worker => worker.mineSlot === main.id)).toBe(true);
    game.buildings.push(createBuilding('natural-hall', 'player', 'townHall', 1700, 500, true));
    game.resources.push({id: 'natural-mine', kind: 'goldMine', x: 1988, y: 500, amount: 6000});
    for (let turn = 0; turn < 2; turn++) {
      const command = AI_SCRIPT_LIBRARY.economy.run(snapshotGame(game), 'player', {version: 'v2', requestedVersion: version});
      expect(command).toMatchObject({type: 'mine', resourceId: 'natural-mine'});
      issuePlayerCommand(game, 'player', command!);
      stepGame(game);
    }
    expect(workers.filter(worker => worker.order.type === 'mine' && worker.order.resourceId === main.id)).toHaveLength(5);
    expect(workers.filter(worker => worker.order.type === 'mine' && worker.order.resourceId === 'natural-mine')).toHaveLength(3);
  });
});
