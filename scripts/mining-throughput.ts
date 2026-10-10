import { writeFileSync } from 'node:fs';
import { createGame, issuePlayerCommand, stepGame } from '../src/shared/sim';
import { MAP_POOL } from '../src/shared/map-pool';
import { createBuilding } from '../src/shared/map';
import { GOLD_MINE_RULES } from '../src/shared/mining';
import { miningHallSite } from '../src/shared/mining-site';
import { seconds } from '../src/shared/time';
import type { MapId } from '../src/shared/types';

// Usage: tsx scripts/mining-throughput.ts report.json [mains|seats|expansions|closest]
// Main/closest modes sweep 1–8 workers; full seat/expansion audits compare 4/5/6.
// All runs use ordinary mining commands and complete simulation steps.
const outputPath = process.argv[2];
const mode = process.argv[3] ?? 'mains';
if (!outputPath || !['mains', 'seats', 'expansions', 'closest'].includes(mode)) {
  throw new Error('Expected output.json and optional mains|seats|expansions|closest');
}
const warmupSeconds = 60, measuredSeconds = 180;
const rows = [];
const scenarios = mode === 'closest'
  ? ['minimum-axis', 'minimum-diagonal', 'long-haul']
  : ['bareDuel', ...MAP_POOL.map(map => map.id)];

for (const mapId of scenarios) {
  const spec = MAP_POOL.find(map => map.id === mapId);
  const players = ['player', ...Array.from({ length: (spec?.players ?? 2) - 1 }, (_, i) => `opponent${i}`)];
  const gameMapId = (spec?.id ?? 'bareDuel') as MapId;
  const template = createGame(gameMapId, { players, aiPlayers: [] });
  const targets = mode === 'expansions'
    ? template.resources.filter(mine => !mine.id.endsWith('-main')).map(mine => mine.id)
    : mode === 'seats' ? players : ['player'];
  const counts = mode === 'closest' || mode === 'mains'
    ? Array.from({ length: 8 }, (_, i) => i + 1) : [4, 5, 6];

  for (const key of targets) for (const count of counts) {
    const game = createGame(gameMapId, { players, aiPlayers: [] });
    const owner = mode === 'expansions' ? 'player' : key;
    let hall = game.buildings.find(building => building.owner === owner)!;
    const mine = game.resources.find(resource => resource.id === (mode === 'expansions' ? key : `gold-${owner}-main`))!;
    if (mode === 'closest') {
      const reach = mapId === 'long-haul' ? 600 : GOLD_MINE_RULES.townHallDistance;
      const angle = mapId === 'minimum-diagonal' ? Math.PI / 4 : 0;
      mine.x = hall.x + Math.cos(angle) * reach;
      mine.y = hall.y + Math.sin(angle) * reach;
    }
    if (mode === 'expansions') {
      const at = miningHallSite(game, mine);
      if (!at) throw new Error(`No legal expansion hall: ${mapId}:${mine.id}`);
      hall = createBuilding('tested-expansion', owner, 'townHall', at.x, at.y, true);
      game.buildings.push(hall);
    }
    // Isolate hauling once a camp has been cleared; retain the actual terrain,
    // mines, standing buildings and obstacles that determine the walk route.
    game.units = [];
    game.players[owner]!.gold = 0;
    game.scriptedVictory = true;
    mine.amount = 100000;
    const dx = mine.x - hall.x, dy = mine.y - hall.y, gap = Math.hypot(dx, dy);
    const workers = Array.from({ length: count }, (_, i) => game.spawnUnit(owner, 'worker',
      hall.x + dx / gap * 80 + dy / gap * i * 3,
      hall.y + dy / gap * 80 - dx / gap * i * 3));
    issuePlayerCommand(game, owner, { type: 'mine', unitIds: workers.map(worker => worker.id), resourceId: mine.id });
    let startGold = 0, moving = 0, gathering = 0, returning = 0, queued = 0;
    let conserved = true;
    const deliveries = Object.fromEntries(workers.map(worker => [worker.id, 0]));
    for (let tick = 0; tick < seconds(warmupSeconds + measuredSeconds); tick++) {
      const before = workers.map(worker => ({ x: worker.x, y: worker.y, load: worker.carryingGold }));
      stepGame(game);
      if (tick === seconds(warmupSeconds) - 1) startGold = game.players[owner]!.gold;
      if (tick < seconds(warmupSeconds)) continue;
      workers.forEach((worker, i) => {
        const old = before[i]!;
        if (old.load > 0 && worker.carryingGold === 0) deliveries[worker.id]! += old.load;
        moving += +(Math.hypot(worker.x - old.x, worker.y - old.y) > .1);
        gathering += +(worker.order.type === 'mine' && worker.order.phase === 'gather');
        returning += +(worker.order.type === 'mine' && worker.order.phase === 'return');
        queued += +(worker.order.type === 'mine' && worker.order.phase === 'toMine'
          && Math.hypot(worker.x - mine.x, worker.y - mine.y) <= GOLD_MINE_RULES.entryRange);
      });
      conserved &&= mine.amount + workers.reduce((sum, worker) => sum + worker.carryingGold, 0) + game.players[owner]!.gold === 100000;
    }
    rows.push({ map: mapId, key, workers: count, distance: gap, hall: { x: hall.x, y: hall.y }, mine: { x: mine.x, y: mine.y },
      goldPerMinute: (game.players[owner]!.gold - startGold) * 60 / measuredSeconds,
      meanWorkersMoving: moving / seconds(measuredSeconds), meanWorkersWorking: gathering / seconds(measuredSeconds),
      meanWorkersReturning: returning / seconds(measuredSeconds), meanWorkersAwaitingAdmission: queued / seconds(measuredSeconds),
      deliveries, mined: 100000 - mine.amount, carried: workers.reduce((sum, worker) => sum + worker.carryingGold, 0),
      banked: game.players[owner]!.gold, conserved });
  }
}
writeFileSync(outputPath, JSON.stringify({ mode, warmupSeconds, measuredSeconds, rules: GOLD_MINE_RULES, rows }, null, 2));
console.table(rows.map(({ map, key, workers, distance, goldPerMinute, conserved }) => ({ map, key, workers, distance, goldPerMinute, conserved })));
