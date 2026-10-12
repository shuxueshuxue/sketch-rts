import { describe, expect, it } from 'vitest';
import { createGame, removeUnit, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../sim';
import type { Unit } from '../types';

type Body = Pick<Unit, 'x' | 'y' | 'radius'>;

// The original ordered Map broad phase is an independent reference for the
// replacement lookup. Stunned ground bodies isolate physical separation from
// movement and combat while still exercising an actual complete game tick.
function originalContacts(units: Body[], width: number, height: number) {
  const buckets = new Map<number, { x: number; y: number; units: Body[] }>();
  for (const unit of units) {
    const x = Math.floor(unit.x / 80), y = Math.floor(unit.y / 80), key = x * 1000 + y;
    const bucket = buckets.get(key);
    if (bucket) bucket.units.push(unit);
    else buckets.set(key, { x, y, units: [unit] });
  }
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  function contact(a: Body, b: Body) {
    const min = a.radius + b.radius, dx = b.x - a.x, dy = b.y - a.y;
    if (dx * dx + dy * dy >= min * min) return;
    const length = Math.hypot(dx, dy), nx = length === 0 ? 1 : dx / length, ny = length === 0 ? 0 : dy / length;
    const push = (min - length) / 2;
    a.x = clamp(a.x - nx * push, width); a.y = clamp(a.y - ny * push, height);
    b.x = clamp(b.x + nx * push, width); b.y = clamp(b.y + ny * push, height);
  }
  function pairs(a: Body[], b: Body[]) {
    for (let i = 0; i < a.length; i++) for (let j = a === b ? i + 1 : 0; j < b.length; j++) contact(a[i]!, b[j]!);
  }
  for (const bucket of buckets.values()) {
    pairs(bucket.units, bucket.units);
    for (const [ox, oy] of [[1, -1], [1, 0], [1, 1], [0, 1]]) {
      const neighbor = buckets.get((bucket.x + ox!) * 1000 + bucket.y + oy!);
      if (neighbor) pairs(bucket.units, neighbor.units);
    }
  }
}

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = [];
  game.scriptedVictory = true; delete game.map.terrain;
  game.map.width = game.map.height = 100_000;
  return game;
}

function body(game: ReturnType<typeof scene>, x: number, y: number) {
  const unit = game.spawnUnit('player', 'footman', x, y);
  unit.effects = [{ type: 'stun', remaining: 10_000 }];
  return unit;
}

function checkTick(game: ReturnType<typeof scene>) {
  const expected = game.units.map(unit => ({ x: unit.x, y: unit.y, radius: unit.radius }));
  originalContacts(expected, game.map.width, game.map.height);
  stepGame(game);
  expect(game.units.map(unit => ({ x: unit.x, y: unit.y, radius: unit.radius }))).toStrictEqual(expected);
}

describe('collision bucket lookup equivalence', () => {
  it('matches original Map contact order through growth, hash collisions, source reorder, removal and restore', () => {
    const game = scene();
    for (let index = 0; index < 96; index++) body(game, (index % 12) * 79 + 800, Math.floor(index / 12) * 79 + 800);
    for (let tick = 0; tick < 24; tick++) {
      for (let index = 0; index < game.units.length; index++) {
        const unit = game.units[index]!;
        unit.x = 800 + ((index * 31 + tick * 17) % 12) * 80 + (index % 3);
        unit.y = 800 + ((index * 19 + tick * 13) % 8) * 80;
        unit.radius = 10 + index % 17;
      }
      if (tick === 3) for (let index = 0; index < 180; index++) body(game, 880, 960);
      if (tick === 7) game.units.reverse();
      if (tick === 9) removeUnit(game, game.units[0]!.id);
      if (tick === 12) restoreSnapshotIntoGame(game, snapshotGame(game), game.nextId);
      if (tick === 16) game.units[1] = { ...game.units[1]!, x: 960 };
      checkTick(game);
    }
    game.units = [];
    checkTick(game);
    const a = body(game, 800, 800), b = body(game, 800, 800);
    checkTick(game);
    expect([a.x, b.x]).toEqual([782, 818]);
  });

  it('reuses a verified prefix while later bodies move, skipped miners enter and trailing members disappear', () => {
    const game = scene();
    const first = body(game, 800, 800), second = body(game, 1200, 800), last = body(game, 1600, 800);
    const miner = game.spawnUnit('player', 'worker', 8000, 8000);
    miner.effects = [{ type: 'stun', remaining: 10_000 }];
    miner.order = { type: 'mine', resourceId: 'missing', phase: 'toMine', timer: 0 };
    // The skipped miner can occur anywhere in source order without changing
    // the ordered prefix of collision members.
    game.units = [first, miner, second, last];
    checkTick(game);
    last.x = 1200;
    checkTick(game);
    miner.order = { type: 'idle' };
    checkTick(game);
    game.units.pop();
    checkTick(game);
    body(game, second.x, second.y);
    checkTick(game);
    expect(first.x).toBe(800);
  });

  it.each([
    [[-0, -0], [0, 0], [-80, 80], [-79, 80]],
    [[80, 0], [0, 80_000], [80, 1], [0, 80_001]],
    [[NaN, 800], [800, NaN], [Infinity, 800], [-Infinity, 800]],
    [[Number.MAX_VALUE, 800], [-Number.MAX_VALUE, 800], [800, Number.MAX_VALUE], [800, -Number.MAX_VALUE]],
  ].map(points => ({ points })))('retains original numeric key equality for coordinates $points', ({ points }) => {
    const game = scene();
    for (const [x, y] of points) body(game, x!, y!);
    checkTick(game);
    checkTick(game);
  });
});
