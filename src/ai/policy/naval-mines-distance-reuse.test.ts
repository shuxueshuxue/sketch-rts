import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { combatCapability } from '../../shared/combat-capabilities';
import { nearestByRoute } from '../../shared/route-selection';
import { snapshotGame } from '../../shared/sim';
import { walkingDistance, type Mover, type Terrain } from '../../shared/terrain';
import { isTransportKind } from '../../shared/transport-role';
import type { GameSnapshot, PlayerId, ResourceNode } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { chooseNavalMine } from './naval-mines';
import { isEnemyOwner } from './ownership';
import { distance } from './spatial';
import type { AiPolicyContext } from './types';
import { effectiveCombatRating, structureRating } from './v6/strength';

type Point = { x: number; y: number };
type MineCoast = { mine: ResourceNode; landing: Point; departure: Point };

// Exact pre-change chooseNavalMine body from 086dffc5ae9e895f38e56f5ddedfa2ab0d7ac86d.
// Keep the second query in the opposite direction, and retain every threat, origin and stable-sort operation.
function referenceChooseNavalMine(snapshot: GameSnapshot, owner: PlayerId, candidates: MineCoast[], options: AiPolicyContext) {
  const fleet = snapshot.units.filter(unit => unit.owner === owner && isTransportKind(unit.kind) && unit.hp > 0);
  const threats = [
    ...snapshot.units.filter(unit => unit.hp > 0 && isEnemyOwner(snapshot, owner, unit.owner, options)
      && combatCapability(snapshot, unit).armed).map(unit => ({ body: unit, rating: effectiveCombatRating(snapshot, unit) })),
    ...snapshot.buildings.filter(building => building.hp > 0 && building.attackDamage > 0
      && isEnemyOwner(snapshot, owner, building.owner, options)).map(building => ({ body: building, rating: structureRating(building) })),
  ];
  return candidates.map(candidate => {
    const origin = nearestByRoute(snapshot.map, [...fleet, candidate.departure], candidate.landing, 'sea')!;
    const road = walkingDistance(snapshot.map, candidate.landing, origin, 'sea')!;
    const threat = threats.filter(({ body }) => distance(body, candidate.mine) < 400)
      .reduce((score, { rating }) => score + rating, 0);
    return { candidate, threat, road };
  }).sort((a, b) => a.threat - b.threat || a.road - b.road)[0]?.candidate;
}

function point(terrain: Terrain, at: number): Point {
  return { x: (at % terrain.cols + .5) * terrain.cell,
    y: (Math.floor(at / terrain.cols) + .5) * terrain.cell };
}

// Independent all-pairs shortest paths. This does not call production grow, exactField or stepAllowed.
// walkingDistance uses integer 5/7 steps even on mud/shallows; pace-weighted groundTravelCost is a different query.
function distances(terrain: Terrain, mover: Mover): Float64Array[] {
  const { cols, rows, cells } = terrain;
  const count = cols * rows;
  const open = (at: number) => (mover === 'sea' ? '~,' : '.,m=').includes(cells[at]!);
  const costs = Array.from({ length: count }, () => new Float64Array(count).fill(Infinity));
  const steps = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
  for (let at = 0; at < count; at += 1) {
    if (!open(at)) continue;
    costs[at]![at] = 0;
    const col = at % cols, row = Math.floor(at / cols);
    for (const [dx, dy] of steps) {
      const c = col + dx, r = row + dy;
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const there = r * cols + c;
      if (!open(there) || dx && dy && (!open(row * cols + c) || !open(r * cols + col))) continue;
      costs[at]![there] = dx && dy ? 7 : 5;
    }
  }
  for (let through = 0; through < count; through += 1) {
    for (let from = 0; from < count; from += 1) {
      const into = costs[from]![through]!;
      if (into === Infinity) continue;
      for (let to = 0; to < count; to += 1) {
        const via = into + costs[through]![to]!;
        if (via < costs[from]![to]!) costs[from]![to] = via;
      }
    }
  }
  return costs;
}

function random(seed: number) {
  let state = seed >>> 0;
  return (length: number) => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % length;
  };
}

describe('naval mine road reuse preserves exact distances and choices', () => {
  it('matches the independent 5/7 graph in both directions for all pairs, including blocked corners and disjoint seas', () => {
    const maps: Terrain[] = [
      { cell: 32, cols: 5, rows: 5, cells: ['~~.~~', '~~.~~', '~~.~~', '~~.~~', '~~.~~'].join('') },
      { cell: 24, cols: 5, rows: 5, cells: ['.,m=.', '.T~#.', 'm~T,m', '=~.T=', '..,..'].join('') },
      { cell: 19, cols: 5, rows: 5, cells: ['~.~~~', '.~~~~', '~~.~~', '~~~~~', '~~~.~'].join('') },
    ];
    const seeded = random(0x58f43a71);
    for (let index = 0; index < 5; index += 1) {
      const alphabet = '...~~,,m=T#';
      maps.push({ cell: 17 + index, cols: 8, rows: 7,
        cells: Array.from({ length: 56 }, () => alphabet[seeded(alphabet.length)]!).join(''),
        levels: Array.from({ length: 56 }, () => String(seeded(3))).join('') });
    }
    let checked = 0, unreachable = 0;
    for (const terrain of maps) {
      const map = { terrain };
      const inputBytes = JSON.stringify(map);
      for (const mover of ['land', 'sea'] as const) {
        const costs = distances(terrain, mover);
        // Target-major ordering exercises cache hits while each reverse query reads another target field.
        for (let to = 0; to < costs.length; to += 1) for (let from = 0; from < costs.length; from += 1) {
          const cost = costs[from]![to]!;
          const expected = cost === Infinity ? undefined : cost * terrain.cell / 5;
          const a = point(terrain, from), b = point(terrain, to);
          expect(walkingDistance(map, a, b, mover)).toBe(expected);
          expect(walkingDistance(map, b, a, mover)).toBe(expected);
          checked += 1;
          if (expected === undefined) unreachable += 1;
        }
        const outside = [{ x: -1, y: 0 }, { x: 0, y: -1 },
          { x: terrain.cols * terrain.cell, y: 0 }, { x: 0, y: terrain.rows * terrain.cell }];
        for (const a of outside) for (let at = 0; at < costs.length; at += 1) {
          const b = point(terrain, at);
          expect(walkingDistance(map, a, b, mover)).toBeUndefined();
          expect(walkingDistance(map, b, a, mover)).toBeUndefined();
        }
      }
      expect(JSON.stringify(map)).toBe(inputBytes);
    }
    expect(checked).toBe(35_110);
    expect(unreachable).toBeGreaterThan(10_000);
  });

  it('preserves exact terrain-free sqrt values for finite fractional, negative and coincident points', () => {
    const points = [{ x: 0, y: -0 }, { x: -193.125, y: 88.875 }, { x: .0001, y: -.0002 },
      { x: 8191.5, y: 2033.75 }, { x: -5, y: -5 }];
    for (const a of points) for (const b of points) for (const mover of ['land', 'sea'] as const) {
      const expected = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      expect(walkingDistance({}, a, b, mover)).toBe(expected);
      expect(walkingDistance({}, b, a, mover)).toBe(expected);
    }
  });

  it.each([false, true])('keeps the complete pre-change candidate, ties and inputs (mirror=%s)', mirror => {
    const cols = 12, rows = 12, cell = 32;
    const at = (col: number, row: number): Point => ({ x: ((mirror ? cols - 1 - col : col) + .5) * cell, y: (row + .5) * cell });
    const positions = [at(1, 3), at(1, 3), at(4, 8), at(9, 4), at(11, 10)];
    const scene = sketchScene('naval-mine-distance-reference').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
      .player('ally', { race: 'grove', team: 'a' });
    for (const [index, place] of positions.entries()) {
      scene.unit('us', index === 3 ? 'carrier' : 'transport', place.x, place.y, { id: `boat-${index}` });
    }
    scene.unit('foe', 'horseArcher', at(8, 7).x, at(8, 7).y, { id: 'armed-foe' })
      .unit('foe', 'worker', at(2, 2).x, at(2, 2).y, { id: 'unarmed-foe' })
      .unit('ally', 'horseArcher', at(4, 9).x, at(4, 9).y, { id: 'armed-ally' })
      .unit('neutral', 'wildling', at(1, 5).x, at(1, 5).y, { id: 'neutral-guard' })
      .building('foe', 'defenseTower', at(11, 11).x, at(11, 11).y, { id: 'foe-tower', complete: true });
    const sites = [at(2, 2), at(4, 9), at(9, 3), at(11, 11), at(0, 0), at(1, 5), at(2, 2)];
    sites.forEach((place, index) => scene.goldMine(`mine-${index}`, place.x, place.y, 6000));
    const game = scene.build().createGame();
    game.units.find(unit => unit.id === 'boat-4')!.hp = 0;
    game.map.width = cols * cell; game.map.height = rows * cell;
    game.map.terrain = { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, index) =>
      (mirror ? cols - 1 - index % cols : index % cols) === 6 ? '.' : '~').join('') };
    const original = snapshotGame(game);
    const unreachable = structuredClone(original);
    unreachable.map.terrain!.cells = '.'.repeat(cols * rows);
    const invalidCoasts = [{ mine: unreachable.resources[0]!, landing: at(1, 1), departure: at(2, 2) }];
    const failure = (call: () => unknown) => { try { call(); return null; } catch (error) {
      return { name: (error as Error).name, message: (error as Error).message };
    } };
    const expectedFailure = failure(() => referenceChooseNavalMine(unreachable, 'us', invalidCoasts, { memory: createAiPolicyMemory() }));
    expect(expectedFailure?.name).toBe('TypeError');
    expect(failure(() => chooseNavalMine(unreachable, 'us', invalidCoasts, { memory: createAiPolicyMemory() }))).toEqual(expectedFailure);
    for (const terrainPresent of [true, false]) for (const boatsPresent of [true, false]) for (const contested of [true, false]) {
      const snapshot = structuredClone(original);
      if (!terrainPresent) delete snapshot.map.terrain;
      if (!boatsPresent) snapshot.units = snapshot.units.filter(unit => !isTransportKind(unit.kind));
      if (!contested) {
        snapshot.units = snapshot.units.filter(unit => unit.owner === 'us');
        snapshot.buildings = [];
      }
      const options: AiPolicyContext = { memory: createAiPolicyMemory(), teams: { us: 'a', ally: 'a', foe: 'b' } };
      const candidates = sites.map((landing, index) => ({ mine: snapshot.resources.find(mine => mine.id === `mine-${index}`)!,
        landing, departure: index === 2 || index === 3 ? at(9, 10) : at(1, 1) }));
      const inputs = JSON.stringify({ snapshot, options, candidates });
      // Permutations and duplicate positions exercise stable candidate ties and tied/disconnected fleet origins.
      const orders = [candidates, [...candidates].reverse(), [candidates[6]!, candidates[0]!], []];
      for (const order of orders) {
        const expected = referenceChooseNavalMine(snapshot, 'us', order, options);
        // A separate terrain identity must also agree before either query direction is cached.
        expect(chooseNavalMine(structuredClone(snapshot), 'us', order, structuredClone(options))).toBe(expected);
        expect(chooseNavalMine(snapshot, 'us', order, options)).toBe(expected);
        // Warm fields and a second traversal must not alter returned identity or any snapshot/options/input bytes.
        expect(chooseNavalMine(snapshot, 'us', order, options)).toBe(expected);
        expect(JSON.stringify({ snapshot, options, candidates })).toBe(inputs);
      }
    }
  });
});
