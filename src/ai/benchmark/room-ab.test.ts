import { expect, it } from 'vitest';
import { roomAbCases, roomAbRanks } from './room-ab';
import { formatRoomAbCsv } from './room-ab-csv';

it('swaps only cohorts and brains, preserving the world, races and family roster', () => {
  const cases = roomAbCases({ a: 'room-baseline-646c', b: 'room-current', seeds: ['one', 'two', 'three'], minutes: 20 });
  expect(cases).toHaveLength(78);
  expect(cases.filter(item => item.mode === 'ffa')).toHaveLength(66);
  expect(new Set(cases.filter(item => item.mode === 'duel').map(item => item.mapId)))
    .toEqual(new Set(['brokenSea', 'sapphireArchipelago']));
  const strip = (item: (typeof cases)[number]) => ({ ...item, name: '', rotation: 0,
    seats: item.seats.map(({ side, brain, ...seat }) => seat) });
  for (let i = 0; i < cases.length; i += 2) {
    expect(strip(cases[i]!)).toEqual(strip(cases[i + 1]!));
    expect(cases[i]!.seats.map(seat => seat.side)).toEqual(cases[i + 1]!.seats.map(seat => seat.side === 'A' ? 'B' : 'A'));
    expect(cases[i]!.seats.map(seat => seat.owner).join()).not.toMatch(/baseline|current/);
  }
});

it('represents each family as both races over three seeds even in the smallest rooms', () => {
  const rows = roomAbCases({ a: 'room-current', b: 'room-current', seeds: ['a', 'b', 'c'], maps: ['greystonePass'], minutes: 15 });
  expect(new Set(rows.flatMap(row => row.seats.map(seat => `${seat.family}/${seat.race}`))).size).toBe(6);
  expect(rows.every(row => row.seats.length === row.nativeSeats)).toBe(true);
});

it('uses tied ranks at timeout and for simultaneous final building losses', () => {
  expect(roomAbRanks([
    { owner: 'a', hasBuildings: true, lastBuildingLossTick: null },
    { owner: 'b', hasBuildings: true, lastBuildingLossTick: null },
    { owner: 'c', hasBuildings: false, lastBuildingLossTick: 400 },
    { owner: 'd', hasBuildings: false, lastBuildingLossTick: 400 },
    { owner: 'e', hasBuildings: false, lastBuildingLossTick: 100 },
  ])).toEqual({ a: 1.5, b: 1.5, c: 3.5, d: 3.5, e: 5 });
});

it('allows a revived seat to survive rather than keeping its first loss as a defeat', () => {
  expect(roomAbRanks([{ owner: 'revived', hasBuildings: true, lastBuildingLossTick: 100 },
    { owner: 'lost', hasBuildings: false, lastBuildingLossTick: 200 }])).toEqual({ revived: 1, lost: 2 });
});

it('escapes JSON, commas, quotes and newlines as RFC 4180 CSV cells', () => {
  expect(formatRoomAbCsv([['a,b', 'say "yes"', '{"count":1}', 'two\nlines', null]]))
    .toBe('"a,b","say ""yes""","{""count"":1}","two\nlines",""\r\n');
});
