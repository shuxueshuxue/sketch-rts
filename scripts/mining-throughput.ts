import { writeFileSync } from 'node:fs';
import { createGame, issuePlayerCommand, stepGame } from '../src/shared/sim';
import { MAP_POOL } from '../src/shared/map-pool';
import { seconds } from '../src/shared/time';
import type { MapId } from '../src/shared/types';

const rows = [];
for (const mapId of ['bareDuel', ...MAP_POOL.map(map => map.id)] as MapId[]) {
  for (let count = 1; count <= 8; count++) {
    const seats = MAP_POOL.find(map => map.id === mapId)?.players ?? 2;
    const players = ['player', ...Array.from({length: seats - 1}, (_, i) => `opponent${i}`)];
    const game = createGame(mapId, {players, aiPlayers: []});
    const hall = game.buildings.find(building => building.owner === 'player')!;
    const mine = game.resources.find(resource => resource.id === 'gold-player-main')!;
    game.units = [];
    game.players.player!.gold = 0;
    game.scriptedVictory = true;
    mine.amount = 100000;
    const workers = Array.from({length: count}, (_, i) => game.spawnUnit('player', 'worker', hall.x + 80, hall.y + 80 + i * 3));
    issuePlayerCommand(game, 'player', {type: 'mine', unitIds: workers.map(worker => worker.id), resourceId: mine.id});
    let startGold = 0, moving = 0, gathering = 0, returning = 0;
    const deliveries = Object.fromEntries(workers.map(worker => [worker.id, 0]));
    for (let tick = 0; tick < seconds(90); tick++) {
      const positions = workers.map(worker => ({x: worker.x, y: worker.y}));
      const loads = workers.map(worker => worker.carryingGold);
      stepGame(game);
      workers.forEach((worker, i) => {if (loads[i]! > 0 && worker.carryingGold === 0) deliveries[worker.id]! += loads[i]!;});
      if (tick === seconds(30) - 1) startGold = game.players.player!.gold;
      if (tick < seconds(30)) continue;
      moving += workers.filter((worker, i) => Math.hypot(worker.x - positions[i]!.x, worker.y - positions[i]!.y) > .1).length;
      gathering += workers.filter(worker => worker.order.type === 'mine' && worker.order.phase === 'gather').length;
      returning += workers.filter(worker => worker.order.type === 'mine' && worker.order.phase === 'return').length;
    }
    rows.push({map: mapId, workers: count, distance: Math.round(Math.hypot(mine.x - hall.x, mine.y - hall.y)), goldPerMinute: game.players.player!.gold - startGold,
      moving: +(moving / seconds(60)).toFixed(2), gathering: +(gathering / seconds(60)).toFixed(2), returning: +(returning / seconds(60)).toFixed(2), deliveries,
      mined: 100000 - mine.amount, carried: workers.reduce((sum, worker) => sum + worker.carryingGold, 0), banked: game.players.player!.gold});
  }
}
writeFileSync(process.argv[2]!, JSON.stringify(rows, null, 2));
console.table(rows);
