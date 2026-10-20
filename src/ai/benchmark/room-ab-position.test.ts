import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { createBuilding } from '../../shared/map';
import { boardUnit } from '../../shared/decks';
import { createGame, removeUnit, snapshotGame, stepGame, strikeUnit } from '../../shared/sim';
import { checksumGame } from '../../shared/sim/checksum';
import { RoomAbPosition, roomAbExchangeRatio, roomAbMinePositions, type RoomAbPositionEvent } from './room-ab-position';
import { summarizeRoomAbPositions } from './room-ab-position-report';
import { roomAbCases } from './room-ab';

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [], players: ['player', 'enemy', 'player-4'] });
  game.units = []; game.buildings = []; game.items = []; game.scriptedVictory = true;
  delete game.map.terrain;
  return game;
}
describe('terminal position measurements', () => {
  it('prices exact native unit/building casualties, separates cross-cohort exchange and ignores lifecycle exits', () => {
    const game = scene(), events: RoomAbPositionEvent[] = [];
    const source = game.spawnUnit('enemy', 'archer', 1800, 1800);
    const victim = game.spawnUnit('player', 'knight', 500, 500);
    const friendly = game.spawnUnit('player-4', 'worker', 700, 500);
    const expired = game.spawnUnit('player', 'mercenary', 1000, 500); expired.expiresTick = 1;
    const scripted = game.spawnUnit('player', 'footman', 1200, 500);
    const hall = createBuilding('hall', 'player', 'townHall', 500, 800, false); game.buildings.push(hall);
    const measure = new RoomAbPosition(game, { player: 'A', enemy: 'B', 'player-4': 'B' }, event => events.push(event));
    // The same-cohort victim is still an enemy in FFA; it must not enter cross A/B exchange.
    strikeUnit(game, source, friendly, 99999, 'spell');
    strikeUnit(game, source, victim, 99999, 'spell');
    strikeUnit(game, source, hall, 99999, 'spell');
    strikeUnit(game, source, expired, 99999, 'spell');
    removeUnit(game, scripted.id); stepGame(game);
    const report = measure.finish();
    const cost = UNIT_DEFS.knight.cost + BUILDING_DEFS.townHall.cost;
    expect(report.seats.player).toMatchObject({ lostGold: cost, lostUnitGold: UNIT_DEFS.knight.cost,
      lostBuildingGold: BUILDING_DEFS.townHall.cost, crossLostGold: cost, ownMiningHallsLost: 1 });
    expect(report.seats.enemy).toMatchObject({ killedGold: cost + UNIT_DEFS.worker.cost, crossKilledGold: cost,
      enemyMiningHallsDestroyed: 1, aliveUnitGold: UNIT_DEFS.archer.cost });
    expect(events.flatMap(e => e.type === 'unit-loss' ? [e.targetId] : []).sort()).toEqual([victim.id, friendly.id].sort());
    expect(report.errors).toEqual([]);
  });

  it('retains neutral, friendly and unattributed losses without inventing hostile kill credit', () => {
    const game = scene();
    const neutral = game.spawnUnit('neutral', 'footman', 1500, 1500);
    const source = game.spawnUnit('player', 'archer', 1800, 1800);
    const a = game.spawnUnit('player', 'worker', 500, 500), b = game.spawnUnit('player', 'worker', 700, 500);
    const c = game.spawnUnit('player', 'worker', 900, 500);
    const measure = new RoomAbPosition(game, { player: 'A' });
    strikeUnit(game, neutral, a, 99999, 'spell'); strikeUnit(game, source, b, 99999, 'spell'); c.hp = 0;
    stepGame(game);
    expect(measure.finish().seats.player).toMatchObject({ lostGold: 3 * UNIT_DEFS.worker.cost, killedGold: 0, crossLostGold: 0 });
  });

  it('attributes a sunk ship and its passengers once each at their catalogue prices', () => {
    const game = scene(), source = game.spawnUnit('enemy', 'warship', 1800, 500);
    const ship = game.spawnUnit('player', 'transport', 600, 600), passenger = game.spawnUnit('player', 'knight', 600, 600);
    boardUnit(ship, passenger, game.units);
    const measure = new RoomAbPosition(game, { player: 'A', enemy: 'B' });
    strikeUnit(game, source, ship, 99999, 'spell'); stepGame(game);
    const report = measure.finish(), cost = UNIT_DEFS.transport.cost + UNIT_DEFS.knight.cost;
    expect(report.seats.player).toMatchObject({ lostUnitGold: cost, aliveUnitGold: 0 });
    expect(report.seats.enemy).toMatchObject({ killedUnitGold: cost, crossKilledGold: cost });
  });

  it('counts unique exclusive mine control and catalogue assets, showing unfinished buildings separately', () => {
    const game = scene();
    game.resources = [
      { id: 'held', kind: 'goldMine', x: 500, y: 500, amount: 900, startAmount: 1000 },
      { id: 'contested', kind: 'goldMine', x: 1500, y: 500, amount: 800, startAmount: 1000 },
      { id: 'empty', kind: 'goldMine', x: 2500, y: 500, amount: 0, startAmount: 1000 },
      { id: 'foundation', kind: 'goldMine', x: 3500, y: 500, amount: 700, startAmount: 1000 },
    ];
    for (const [id, owner, x, complete] of [['a', 'player', 500, true], ['duplicate', 'player', 520, true],
      ['b', 'player', 1500, true], ['c', 'enemy', 1510, true], ['d', 'player', 2500, true],
      ['e', 'player', 3500, false]] as const) game.buildings.push(createBuilding(id, owner, 'townHall', x, 700, complete));
    game.spawnUnit('player', 'knight', 500, 1000);
    const before = JSON.stringify(snapshotGame(game)), report = new RoomAbPosition(game, { player: 'A', enemy: 'B' }).finish();
    expect(report.seats.player).toMatchObject({ heldMines: 1, heldMineReserves: 900, aliveUnitGold: UNIT_DEFS.knight.cost,
      aliveBuildingGold: 5 * BUILDING_DEFS.townHall.cost, unfinishedBuildingGold: BUILDING_DEFS.townHall.cost });
    expect(report.mines.map(m => m.status)).toEqual(['held', 'contested', 'exhausted', 'unheld']);
    expect(report.mines[0]!.hallIds).toEqual(['a', 'duplicate']);
    expect(JSON.stringify(snapshotGame(game))).toBe(before);
  });

  it('does not claim a mine through water merely because a hall is nearby', () => {
    const game = scene();
    game.map.terrain = { cell: 32, cols: 6, rows: 3, cells: '..~~..'.repeat(3) };
    game.resources = [{ id: 'island', kind: 'goldMine', x: 48, y: 48, amount: 500, startAmount: 500 }];
    game.buildings = [createBuilding('other-island', 'player', 'townHall', 144, 48, true)];
    expect(roomAbMinePositions(game)[0]!.status).toBe('unheld');
  });

  it('uses actual post-upkeep mining deposits in (end-60s, end], excluding earlier deliveries and other gold changes', () => {
    const a = createGame('bareDuel', { aiPlayers: [] }), b = createGame('bareDuel', { aiPlayers: [] });
    a.scriptedVictory = b.scriptedVictory = true;
    const events: RoomAbPositionEvent[] = [], measure = new RoomAbPosition(b, { player: 'A' }, e => events.push(e));
    for (const game of [a, b]) {
      const worker = game.units.find(u => u.owner === 'player')!, hall = game.buildings.find(h => h.owner === 'player')!;
      const deliver = (tick: number, gold: number) => {
        game.tick = tick - 1; game.players.player.supplyUsed = 100;
        worker.x = hall.x; worker.y = hall.y; worker.carryingGold = gold;
        worker.order = { type: 'mine', resourceId: game.resources[0]!.id, phase: 'return', timer: 0 }; stepGame(game);
      };
      deliver(1, 10); deliver(1000, 10); deliver(1200, 10); deliver(2399, 1);
      game.tick = 2400; game.players.player.gold += 10000;
    }
    const result = measure.finish();
    expect(result.seats.player).toMatchObject({ miningWindowSeconds: 60, miningWindowGold: .33, miningGoldPerMinute: .33 });
    expect(events.filter(e => e.type === 'mining-income').map(e => e.creditedGold)).toEqual([3.33, 3.33, 3.33, .33]);
    expect(checksumGame(a)).toBe(checksumGame(b));
    expect(snapshotGame(a)).toEqual(snapshotGame(b));
  });
});

describe('separate A/B metric comparisons', () => {
  function pair() {
    const items = roomAbCases({ a: 'room-baseline-646c', b: 'room-baseline-646c', minutes: 20, seeds: ['paired'], maps: ['greystonePass'] });
    const game = scene(); game.spawnUnit('player', 'knight', 500, 500); game.spawnUnit('enemy', 'worker', 2000, 2000);
    const position = new RoomAbPosition(game, { player: 'A', enemy: 'B' }).finish();
    return items.map(item => ({ item, timeout: true, position: structuredClone(position) }));
  }
  it('reports finite, no-loss and no-exchange ratios explicitly instead of JSON Infinity/null ambiguity', () => {
    expect(roomAbExchangeRatio(30, 10)).toEqual({ status: 'finite', value: 3 });
    expect(roomAbExchangeRatio(30, 0)).toEqual({ status: 'no-loss', value: null });
    expect(roomAbExchangeRatio(0, 0)).toEqual({ status: 'no-exchange', value: null });
  });
  it('cancels seat advantages after swapping cohorts and retains per-metric game win counts', () => {
    const report = summarizeRoomAbPositions(pair());
    expect(report.available).toBe(true); if (!report.available) return;
    expect(report.primaryTimeoutFfa.metrics.aliveUnitGold).toMatchObject({ games: { aWins: 1, bWins: 1, ties: 0 },
      paired: { aWins: 0, bWins: 0, ties: 1 }, meanPairedDelta: 0 });
    expect(report.maps[0]!.timeoutFfa.metrics.aliveUnitGold!.meanPairedDelta).toBe(0);
    expect(report.mirrored).toBe(true); expect(report.finitePairedDeltasZero).toBe(true);
    expect(report.primaryTimeoutFfa.metrics.exchangeRatio!.games.unavailable).toBe(2);
  });
  it('detects directional advantages, uses ratios of group totals, and separates timeout from decisive games', () => {
    const rows = pair();
    for (const row of rows) {
      const owner = row.item.seats.find(s => s.side === 'A')!.owner;
      const other = row.item.seats.find(s => s.side === 'B')!.owner;
      Object.assign(row.position.seats[owner]!, { killedGold: 100, lostGold: 10, lostUnitGold: 10, exchangeNetGold: 90 });
      Object.assign(row.position.seats[other]!, { killedGold: 5, lostGold: 5, lostUnitGold: 5, exchangeNetGold: 0 });
    }
    rows[1]!.timeout = false;
    const report = summarizeRoomAbPositions(rows); if (!report.available) throw new Error('missing');
    expect(report.allEndFfa.metrics.exchangeRatio!.games).toEqual({ aWins: 2, bWins: 0, ties: 0, unavailable: 0 });
    expect(report.allEndFfa.metrics.lostGold!.games.bWins).toBe(2);
    expect(report.primaryTimeoutFfa).toMatchObject({ games: 1, pairs: 0 });
    expect(report.mirrored).toBe(false);
    expect(report.allEndFfa.metrics.exchangeNetGold!.meanPairedDelta).toBe(90);
  });
  it('divides cohort gold totals rather than averaging individual seat ratios in full-seat FFA', () => {
    const items = roomAbCases({ a: 'room-current', b: 'room-baseline-646c', minutes: 20, seeds: ['ratio'], maps: ['brokenSea'], modes: ['ffa'] });
    const rows = items.map(item => {
      const game = scene(), sides = Object.fromEntries(item.seats.map(s => [s.owner, s.side]));
      const position = new RoomAbPosition(game, sides).finish();
      let index = 0;
      for (const seat of item.seats) {
        const [killedGold, lostGold] = seat.side === 'B' ? [100, 50] : index++ === 0 ? [90, 10] : [10, 90];
        Object.assign(position.seats[seat.owner]!, { killedGold, lostGold });
      }
      return { item, timeout: true, position };
    });
    const report = summarizeRoomAbPositions(rows); if (!report.available) throw new Error('missing');
    expect(report.matches[0]!.comparisons.exchangeRatio).toEqual({ a: { status: 'finite', value: 1 },
      b: { status: 'finite', value: 2 }, delta: -1, winner: 'B' });
    expect(report.primaryTimeoutFfa.metrics.exchangeRatio!.games.bWins).toBe(2);
  });
  it('reports missing older evidence and refuses incomplete spawn pairs instead of filling zeros', () => {
    const rows = pair();
    expect(summarizeRoomAbPositions([{ ...rows[0]!, position: null }])).toEqual({ available: false, missingCases: [rows[0]!.item.name] });
    expect(() => summarizeRoomAbPositions(rows.slice(0, 1))).toThrow('Incomplete position pair');
  });
});
