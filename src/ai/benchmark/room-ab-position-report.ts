import type { RoomAbCase } from './room-ab';
import { roomAbExchangeRatio, type RoomAbExchangeRatio, type RoomAbPositionReport, type RoomAbPositionSeat } from './room-ab-position';

/** Each row stands alone: there is deliberately no overall score or position-derived winner. */
export const ROOM_AB_POSITION_METRICS = {
  killedUnitGold: 1, killedBuildingGold: 1, killedGold: 1,
  lostUnitGold: -1, lostBuildingGold: -1, lostGold: -1, exchangeNetGold: 1, exchangeRatio: 1,
  crossKilledGold: 1, crossLostGold: -1, crossExchangeNetGold: 1, crossExchangeRatio: 1,
  aliveUnitGold: 1, aliveBuildingGold: 1, heldMines: 1, heldMineReserves: 1, miningGoldPerMinute: 1,
  enemyMiningHallsDestroyed: 1, ownMiningHallsLost: -1,
} as const;
type Metric = keyof typeof ROOM_AB_POSITION_METRICS;
type Value = number | RoomAbExchangeRatio;
type Winner = 'A' | 'B' | 'tie' | 'unavailable';
type PositionMatch = { item: RoomAbCase; timeout: boolean; position?: RoomAbPositionReport | null };
const keys = Object.keys(ROOM_AB_POSITION_METRICS) as Metric[];
const small = (value: number) => Math.abs(value) < 1e-9 ? 0 : value;
function compare(a: Value, b: Value, direction: number) {
  const av = typeof a === 'number' ? a : a.value, bv = typeof b === 'number' ? b : b.value;
  const delta = av !== null && bv !== null ? small(av - bv) : null;
  let winner: Winner = 'unavailable';
  if (delta !== null) winner = delta === 0 ? 'tie' : delta * direction > 0 ? 'A' : 'B';
  else if (typeof a !== 'number' && typeof b !== 'number' && a.status !== 'no-exchange' && b.status !== 'no-exchange') {
    // A positive numerator with zero losses is above every finite ratio; two such ratios tie.
    winner = a.status === b.status ? 'tie' : a.status === 'no-loss' ? 'A' : 'B';
  }
  return { a, b, delta, winner };
}
function cohort(seats: RoomAbPositionSeat[]) {
  const sum = (key: Exclude<Metric, 'exchangeRatio' | 'crossExchangeRatio'>) => seats.reduce((v, seat) => v + seat[key], 0);
  return Object.fromEntries(keys.map(key => [key, key === 'exchangeRatio' ? roomAbExchangeRatio(sum('killedGold'), sum('lostGold'))
    : key === 'crossExchangeRatio' ? roomAbExchangeRatio(sum('crossKilledGold'), sum('crossLostGold')) : sum(key)])) as Record<Metric, Value>;
}
export function summarizeRoomAbPositions(reports: PositionMatch[]) {
  const missing = reports.filter(r => !r.position);
  if (missing.length) return { available: false as const, missingCases: missing.map(r => r.item.name) };
  const matches = reports.map(r => {
    const side = (which: 'A' | 'B') => cohort(r.item.seats.filter(s => s.side === which).map(s => {
      const seat = r.position!.seats[s.owner];
      if (!seat) throw new Error(`Missing position seat ${r.item.name}/${s.owner}`);
      return seat;
    }));
    const a = side('A'), b = side('B');
    return { case: r.item.name, pair: r.item.pair, mapId: r.item.mapId, mode: r.item.mode,
      seats: r.item.seats.length, rotation: r.item.rotation, timeout: r.timeout,
      comparisons: Object.fromEntries(keys.map(key => [key, compare(a[key], b[key], ROOM_AB_POSITION_METRICS[key])])) as
        Record<Metric, ReturnType<typeof compare>> };
  });
  const paired = [...new Set(matches.map(m => m.pair))].map(pair => {
    const rows = matches.filter(m => m.pair === pair).sort((a, b) => a.rotation - b.rotation);
    if (rows.length !== 2 || rows[0]!.rotation !== 0 || rows[1]!.rotation !== 1) throw new Error(`Incomplete position pair ${pair}`);
    const [a, b] = rows as [typeof rows[number], typeof rows[number]];
    return { pair, mapId: a.mapId, mode: a.mode, seats: a.seats, timeoutPair: a.timeout && b.timeout,
      metrics: Object.fromEntries(keys.map(key => {
        const left = a.comparisons[key], right = b.comparisons[key];
        // Raw A-minus-B differences averaged over the two spawn rotations, NOT a weighted score.
        const delta = left.delta === null || right.delta === null ? null : small((left.delta + right.delta) / 2);
        const winner: Winner = delta === null ? 'unavailable' : delta === 0 ? 'tie'
          : delta * ROOM_AB_POSITION_METRICS[key] > 0 ? 'A' : 'B';
        const mirror = JSON.stringify(left.a) === JSON.stringify(right.b) && JSON.stringify(left.b) === JSON.stringify(right.a);
        return [key, { delta, winner, mirror }];
      })) as Record<Metric, { delta: number | null; winner: Winner; mirror: boolean }> };
  });
  function group(selected: typeof matches, pairs: typeof paired) {
    const counts = (winners: Winner[]) => ({ aWins: winners.filter(w => w === 'A').length,
      bWins: winners.filter(w => w === 'B').length, ties: winners.filter(w => w === 'tie').length,
      unavailable: winners.filter(w => w === 'unavailable').length });
    return { games: selected.length, pairs: pairs.length,
      metrics: Object.fromEntries(keys.map(key => {
        const finite = pairs.map(p => p.metrics[key].delta).filter((d): d is number => d !== null);
        return [key, { higherIsBetter: ROOM_AB_POSITION_METRICS[key] > 0,
          games: counts(selected.map(m => m.comparisons[key].winner)),
          paired: counts(pairs.map(p => p.metrics[key].winner)), finitePairs: finite.length,
          meanPairedDelta: finite.length ? small(finite.reduce((a, b) => a + b, 0) / finite.length) : null,
          minPairedDelta: finite.length ? Math.min(...finite) : null, maxPairedDelta: finite.length ? Math.max(...finite) : null }];
      })) };
  }
  const ffa = matches.filter(m => m.mode === 'ffa'), fp = paired.filter(p => p.mode === 'ffa');
  const duel = matches.filter(m => m.seats === 2), dp = paired.filter(p => p.seats === 2);
  return { available: true as const, version: 1, aggregation: 'cohort-sum; ratio-of-cohort-sums; paired=(rotation0+rotation1)/2',
    primaryTimeoutFfa: group(ffa.filter(m => m.timeout), fp.filter(p => p.timeoutPair)),
    allEndFfa: group(ffa, fp), auxiliaryTimeoutDuel: group(duel.filter(m => m.timeout), dp.filter(p => p.timeoutPair)),
    allEndDuel: group(duel, dp),
    maps: [...new Set(matches.map(m => m.mapId))].map(mapId => ({ mapId,
      timeoutFfa: group(ffa.filter(m => m.mapId === mapId && m.timeout), fp.filter(p => p.mapId === mapId && p.timeoutPair)),
      allEndFfa: group(ffa.filter(m => m.mapId === mapId), fp.filter(p => p.mapId === mapId)),
      auxiliaryDuel: group(duel.filter(m => m.mapId === mapId), dp.filter(p => p.mapId === mapId)) })),
    matches, pairs: paired, mirrored: paired.every(p => keys.every(k => p.metrics[k].mirror)),
    finitePairedDeltasZero: paired.every(p => keys.every(k => p.metrics[k].delta === null || p.metrics[k].delta === 0)),
  };
}
