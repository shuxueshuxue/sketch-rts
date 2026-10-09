import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from './catalog';
import { createBuilding } from './map';
import { createRoom } from './rooms';
import { createSaveGameRecord, restoreGameFromSave, type SaveGameRecord } from './savegame';
import { shipBodyClearAtPose } from './ship-collisions';
import { PREVIOUS_SHIP_TRAIN_COST } from './ship-equipment';
import { SHIP_KINDS, SHIP_SIZE_MULTIPLIER, SHIP_SIZE_VERSION, type ShipKind } from './ship-geometry';
import { hullFits } from './ship-navigation';
import { createGame, issuePlayerCommand, stepGame } from './sim';
import { CHECKSUM_VERSION, checksumGame } from './sim/checksum';
import type { GameMap } from './types';

const STARTING_GOLD = 10000;

function coast(cell: (x: number, y: number) => string = x => x < 10 ? '.' : '~'): GameMap {
  let cells = '';
  for (let y = 0; y < 40; y++) for (let x = 0; x < 50; x++) cells += cell(x, y);
  return { ...createGame('bareDuel', { aiPlayers: [] }).map, width: 1600, height: 1280, terrain: { cell: 32, cols: 50, rows: 40, cells } };
}

function scene(map = coast()) {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.map = map; game.units = []; game.items = []; game.resources = []; game.mercenaryCamps = []; game.shops = [];
  game.scriptedVictory = true;
  const dock = createBuilding('dock', 'player', 'shipyard', 304, 624, true);
  game.buildings = [dock, ...Array.from({ length: 10 }, (_, index) => createBuilding(`supply-${index}`, 'player', 'farm', 80, 80 + index * 96, true))];
  game.players.player.gold = STARTING_GOLD; game.players.player.supplyCap = 60;
  game.match.stats.goldSpent.player = 0;
  return { game, dock };
}

function train(context: ReturnType<typeof scene>, kind: ShipKind) {
  issuePlayerCommand(context.game, 'player', { type: 'train', buildingId: context.dock.id, unitKind: kind });
  return context.dock.queue.at(-1)!;
}

function saveGame(game: ReturnType<typeof scene>['game']) {
  const room = { ...createRoom({ id: 'ship-prices', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' }), status: 'inMatch' as const };
  return createSaveGameRecord(game, room, { id: 'ship-prices' });
}

function savedPrices(save: SaveGameRecord) {
  save.runtime.checksumVersion = CHECKSUM_VERSION - 1;
  const jobs = save.snapshot.buildings[0]!.queue;
  const paid = jobs.reduce((sum, job) => {
    delete job.paidGold;
    return sum + PREVIOUS_SHIP_TRAIN_COST[job.unitKind as ShipKind];
  }, 0);
  save.snapshot.players.player.gold = STARTING_GOLD - paid;
  save.snapshot.match.stats.goldSpent.player = paid;
}

describe('ship training payments and cancellation', () => {
  it.each(SHIP_KINDS)('%s records the complete current price and refunds each clicked job exactly once', kind => {
    const context = scene(), { game, dock } = context;
    const first = train(context, kind), second = train(context, kind), cost = UNIT_DEFS[kind].cost;
    expect(first.paidGold).toBe(cost); expect(second.paidGold).toBe(cost);
    expect(game.players.player.gold).toBe(STARTING_GOLD - cost * 2);
    expect(game.match.stats.goldSpent.player).toBe(cost * 2);

    const cancel = { type: 'cancelTraining', buildingId: dock.id, jobId: first.id! } as const;
    issuePlayerCommand(game, 'player', cancel);
    issuePlayerCommand(game, 'player', cancel);
    expect(dock.queue).toEqual([second]);
    expect(game.players.player.gold).toBe(STARTING_GOLD - cost);
    expect(game.match.stats.goldSpent.player).toBe(cost);

    issuePlayerCommand(game, 'player', { ...cancel, jobId: second.id! });
    issuePlayerCommand(game, 'player', { ...cancel, jobId: second.id! });
    expect(dock.queue).toHaveLength(0);
    expect(game.players.player.gold).toBe(STARTING_GOLD);
    expect(game.match.stats.goldSpent.player).toBe(0);
  });

  it.each(SHIP_KINDS)('%s restores unfinished old jobs at their historical price without increasing refunds', kind => {
    const context = scene();
    train(context, kind); train(context, kind);
    const saved = saveGame(context.game); savedPrices(saved);
    const source = JSON.stringify(saved), restored = restoreGameFromSave(saved), dock = restored.buildings[0]!;
    const [first, second] = dock.queue, previous = PREVIOUS_SHIP_TRAIN_COST[kind];
    expect(dock.queue.map(job => job.paidGold)).toEqual([previous, previous]);
    expect(restored.players.player.gold).toBe(STARTING_GOLD - previous * 2);

    const cancel = { type: 'cancelTraining', buildingId: dock.id, jobId: first!.id! } as const;
    issuePlayerCommand(restored, 'player', cancel);
    issuePlayerCommand(restored, 'player', cancel);
    expect(dock.queue).toEqual([second]);
    expect(restored.players.player.gold).toBe(STARTING_GOLD - previous);
    expect(restored.match.stats.goldSpent.player).toBe(previous);

    issuePlayerCommand(restored, 'player', { ...cancel, jobId: second!.id! });
    issuePlayerCommand(restored, 'player', { ...cancel, jobId: second!.id! });
    expect(dock.queue).toHaveLength(0);
    expect(restored.players.player.gold).toBe(STARTING_GOLD);
    expect(restored.match.stats.goldSpent.player).toBe(0);
    expect(JSON.stringify(saved)).toBe(source);
  });

  it.each(SHIP_KINDS)('%s preserves a historical payment while waiting for a safe enlarged launch berth', kind => {
    // The connected dock water is too small for even the smallest complete hull.
    const context = scene(coast((x, y) => x >= 10 && x <= 11 && y === 19 ? '~' : '.'));
    const originalJob = train(context, kind); originalJob.remaining = 0;
    const saved = saveGame(context.game); savedPrices(saved);
    const source = JSON.stringify(saved), restored = restoreGameFromSave(saved), dock = restored.buildings[0]!, job = dock.queue[0]!;
    restored.scriptedVictory = true;
    const balance = STARTING_GOLD - PREVIOUS_SHIP_TRAIN_COST[kind], nextId = restored.nextId;
    for (let tick = 0; tick < 3; tick++) stepGame(restored);
    expect(dock.queue).toEqual([job]); expect(job.remaining).toBe(0);
    expect(job.paidGold).toBe(PREVIOUS_SHIP_TRAIN_COST[kind]);
    expect(restored.units).toHaveLength(0); expect(restored.nextId).toBe(nextId);
    expect(restored.players.player.gold).toBe(balance);

    restored.map.terrain!.cells = coast().terrain!.cells;
    stepGame(restored);
    expect(dock.queue).toHaveLength(0); expect(restored.units).toHaveLength(1);
    const ship = restored.units[0]!, pose = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
    expect(ship.kind).toBe(kind); expect(ship.shipSizeVersion).toBe(SHIP_SIZE_VERSION);
    expect(ship.radius).toBeCloseTo(UNIT_DEFS[kind].radius * SHIP_SIZE_MULTIPLIER);
    expect(hullFits(restored.map, ship)).toBe(true);
    expect(shipBodyClearAtPose(restored.map, ship, pose, restored.buildings)).toBe(true);
    expect(restored.players.player.gold).toBe(balance);
    expect(restored.match.stats.goldSpent.player).toBe(PREVIOUS_SHIP_TRAIN_COST[kind]);

    issuePlayerCommand(restored, 'player', { type: 'cancelTraining', buildingId: dock.id, jobId: job.id! });
    expect(restored.players.player.gold).toBe(balance);
    expect(JSON.stringify(saved)).toBe(source);
  });

  it('preserves all current paid amounts through save and replay without mutating the saved input', () => {
    const context = scene(), { game, dock } = context;
    for (const kind of SHIP_KINDS) train(context, kind);
    stepGame(game);
    const saved = saveGame(game), source = JSON.stringify(saved), restored = restoreGameFromSave(saved);
    restored.scriptedVictory = true;
    expect(restored.buildings[0]!.queue.map(job => job.paidGold)).toEqual(SHIP_KINDS.map(kind => UNIT_DEFS[kind].cost));
    expect(checksumGame(restored)).toBe(saved.runtime.checksum);

    // A refund-affecting payment belongs to deterministic state, even before cancellation.
    restored.buildings[0]!.queue[0]!.paidGold! += 1;
    expect(checksumGame(restored)).not.toBe(checksumGame(game));
    restored.buildings[0]!.queue[0]!.paidGold! -= 1;
    for (let tick = 0; tick < 3; tick++) {
      stepGame(game); stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
    for (const job of [...dock.queue]) {
      const cancel = { type: 'cancelTraining', buildingId: dock.id, jobId: job.id! } as const;
      for (const replay of [game, restored]) {
        issuePlayerCommand(replay, 'player', cancel);
        issuePlayerCommand(replay, 'player', cancel);
      }
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
    expect(game.players.player.gold).toBe(STARTING_GOLD);
    expect(restored.players.player.gold).toBe(STARTING_GOLD);
    expect(JSON.stringify(saved)).toBe(source);
  });
});
