import { describe, expect, it } from "vitest";
import { generateMap } from "./generated-map";
import { MAP_POOL } from "./map-pool";
import { createRoom, roomToGameSetup } from "./rooms";
import {
  isOpenGround,
  setBuildingBodies,
  shareBuildingBodies,
  walkDestination,
  type Mover,
  type Terrain,
} from "./terrain";

type TestMap = { terrain: Terrain; width: number; height: number };
type Point = { x: number; y: number };

function testMap(lines: readonly string[]): TestMap {
  const terrain = { cell: 32, cols: lines[0]!.length, rows: lines.length, cells: lines.join("") };
  return { terrain, width: terrain.cols * terrain.cell, height: terrain.rows * terrain.cell };
}

function center(map: TestMap, at: number): Point {
  return {
    x: (at % map.terrain.cols + 0.5) * map.terrain.cell,
    y: (Math.floor(at / map.terrain.cols) + 0.5) * map.terrain.cell,
  };
}

// Independent connectivity reference: flood the physical cells, without the production flow-tile regions/windows.
// Diagonal movement needs both adjoining orthogonal cells, just as ordinary terrain movement does.
function labelGround(map: TestMap, mover: Mover) {
  const { cols, rows } = map.terrain;
  const open = Uint8Array.from({ length: cols * rows }, (_, at) => {
    const point = center(map, at);
    return isOpenGround(map, point.x, point.y, mover) ? 1 : 0;
  });
  const labels = new Int32Array(open.length).fill(-1);
  const groups: number[][] = [];
  const steps = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
  for (let seed = 0; seed < open.length; seed += 1) {
    if (!open[seed] || labels[seed] !== -1) continue;
    const group = groups.length;
    const queue = [seed];
    labels[seed] = group;
    for (let head = 0; head < queue.length; head += 1) {
      const at = queue[head]!;
      const col = at % cols, row = Math.floor(at / cols);
      for (const [dx, dy] of steps) {
        const c = col + dx, r = row + dy;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const there = r * cols + c;
        if (!open[there] || labels[there] !== -1) continue;
        if (dx && dy && (!open[row * cols + c] || !open[r * cols + col])) continue;
        labels[there] = group;
        queue.push(there);
      }
    }
    groups.push(queue);
  }
  return { labels, groups };
}

// Test-only pre-optimization full-square ring scan. Callers supply an open target (its sole goal seed is itself),
// or a deep building interior explicitly known to have no open goal seed within the production three-cell reach.
// Keep the old squared-radius guard, bounds and padded-index tie-break rather than reproducing a border traversal here.
function squareRingDestination(map: TestMap, labels: Int32Array, near: number, target: number, goal = center(map, target)): Point {
  const island = labels[near]!;
  if (labels[target] === island) return goal;
  const { cols, rows } = map.terrain;
  const width = cols + 2;
  const col = target % cols, row = Math.floor(target / cols);
  let best = near;
  let bestDistance = Infinity;
  for (let ring = 1; ring <= Math.max(cols, rows) && ring * ring <= bestDistance; ring += 1) {
    for (let r = row - ring; r <= row + ring; r += 1) {
      for (let c = col - ring; c <= col + ring; c += 1) {
        if (Math.max(Math.abs(c - col), Math.abs(r - row)) !== ring || c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const at = r * cols + c;
        if (labels[at] !== island) continue;
        const gap = (c - col) ** 2 + (r - row) ** 2;
        const padded = (r + 1) * width + c + 1;
        const bestPadded = (Math.floor(best / cols) + 1) * width + best % cols + 1;
        if (gap < bestDistance || (gap === bestDistance && padded < bestPadded)) {
          bestDistance = gap;
          best = at;
        }
      }
    }
  }
  return center(map, best);
}

function compareDestination(map: TestMap, mover: Mover, labels: Int32Array, near: number, target: number, goal = center(map, target)) {
  const expected = squareRingDestination(map, labels, near, target, goal);
  expect(walkDestination(map, center(map, near), goal, mover), `${mover}: ${near} -> ${target}`).toEqual(expected);
}

function randomNumbers(seed: number) {
  let state = seed >>> 0;
  return (length: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % length;
  };
}

describe("reachable terrain destinations preserve the square-ring result", () => {
  it("matches 6,561 isolated-island pairs, including warm lookups and nearest-cache turnover", () => {
    const map = testMap(Array.from({ length: 17 }, (_, row) => Array.from({ length: 17 }, (_, col) => row % 2 === 0 && col % 2 === 0 ? "." : "~").join("")));
    const { labels, groups } = labelGround(map, "land");
    expect(groups).toHaveLength(81);
    const cells = groups.map(group => group[0]!);
    for (const near of cells) for (const target of cells) compareDestination(map, "land", labels, near, target);
    // This pair was queried before more than 4,096 distinct (target, island) pairs filled the real production cache.
    compareDestination(map, "land", labels, cells[0]!, cells.at(-1)!);
    compareDestination(map, "land", labels, cells.at(-1)!, cells[0]!);
  });

  it("matches seeded sapphireArchipelago land/sea queries through the public production path", () => {
    const layout = MAP_POOL.find(map => map.id === "sapphireArchipelago")!;
    const { options } = roomToGameSetup(createRoom({ id: "reachable-ring-reference", host: { id: "host", name: "Host" }, mapId: layout.id, humanCount: 1, aiCount: 5 }));
    const drawn = generateMap(layout.layout, options.players!, options.teams as Record<string, string>);
    const map: TestMap = { terrain: drawn.terrain, width: drawn.size, height: drawn.size };
    const random = randomNumbers(0x73d2a415);
    let queried = 0, disconnected = 0;
    for (const mover of ["land", "sea"] as const) {
      const { labels, groups } = labelGround(map, mover);
      expect(groups.length).toBeGreaterThan(0);
      const all = groups.flat();
      for (let sample = 0; sample < 1_024; sample += 1) {
        const near = all[random(all.length)]!;
        const own = groups[labels[near]!]!;
        // Most queries cover arbitrary positions on an island, preserving the requested subcell goal exactly.
        // The remaining queries deliberately cross components and exercise cold nearest-island scans.
        const targetGroup = sample % 8 === 0 && groups.length > 1
          ? groups[(labels[near]! + 1 + random(groups.length - 1)) % groups.length]!
          : own;
        const selected = targetGroup[random(targetGroup.length)]!;
        const goal = center(map, selected);
        goal.x += random(15) - 7;
        goal.y += random(15) - 7;
        compareDestination(map, mover, labels, near, selected, goal);
        queried += 1;
        if (labels[near] !== labels[selected]) disconnected += 1;
      }
    }
    expect(queried).toBe(2_048);
    expect(disconnected).toBeGreaterThanOrEqual(128);
  }, 120_000);

  it("keeps exact top/left ties, corner restrictions, narrow maps and rings reaching the map bound", () => {
    const fixtures = [
      testMap([".......", ".~~~~~.", ".~~~~~.", ".~~.~~.", ".~~~~~.", ".~~~~~.", "......."]),
      testMap([".~.~.", "~.~.~", ".~.~.", "~.~.~", ".~.~."]),
      testMap([".~.~.~.~.~.~.~.~.~.~.~.~.~.~.~."]),
      testMap([".", "~", ".", "~", ".", "~", "."]),
      testMap([".~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~", "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~", "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~", "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~."]),
      // Border traversal encounters the bottom candidate before the equally near left candidate with a lower index.
      testMap(["~~~~~~~", "~~~~~~~", "~~~~~~~", ".~~.~~~", ".~~~~~~", ".~~~~~~", "....~~~"]),
    ];
    for (const map of fixtures) for (const mover of ["land", "sea"] as const) {
      const { labels, groups } = labelGround(map, mover);
      const cells = groups.flat();
      for (const near of cells) for (const target of cells) compareDestination(map, mover, labels, near, target);
    }
    const tie = fixtures[0]!;
    expect(walkDestination(tie, center(tie, 0), center(tie, 24))).toEqual(center(tie, 3));
    const changedVisitOrder = fixtures.at(-1)!;
    expect(walkDestination(changedVisitOrder, center(changedVisitOrder, 42), center(changedVisitOrder, 24))).toEqual(center(changedVisitOrder, 21));
  });

  it("preserves changed obstruction regions and the geometry retained by a snapshot", () => {
    const map = testMap(Array(9).fill("..........."));
    const wall = Array.from({ length: 9 }, (_, row) => ({ ...center(map, row * 11 + 5), radius: 16 }));
    setBuildingBodies(map, wall);
    const { labels } = labelGround(map, "land");
    for (const row of [0, 4, 8]) for (const col of [0, 1, 9, 10]) {
      const near = row * 11 + col;
      for (const target of [0, 10, 44, 54, 88, 98]) compareDestination(map, "land", labels, near, target);
    }
    // A goal covered by the wall remains reachable to its own side's seed; this path bypasses the nearest-island scan.
    expect(walkDestination(map, center(map, 46), center(map, 49))).toEqual(center(map, 48));
    expect(walkDestination(map, center(map, 52), center(map, 49))).toEqual(center(map, 50));
    const snapshot = { ...map };
    shareBuildingBodies(map, snapshot);
    setBuildingBodies(map, []);
    expect(walkDestination(map, center(map, 44), center(map, 54))).toEqual(center(map, 54));
    compareDestination(snapshot, "land", labels, 44, 54);
    // Restoring the same physical wall rebuilds an equivalent routing field, regardless of its cache history.
    setBuildingBodies(map, wall);
    compareDestination(map, "land", labelGround(map, "land").labels, 44, 54);

    const thick = testMap(Array(11).fill("....................."));
    const target = 5 * 21 + 10;
    setBuildingBodies(thick, [{ ...center(thick, target), radius: 144 }]);
    const thickLabels = labelGround(thick, "land").labels;
    // The target lies four blocked cells from every building edge, so no three-cell goal seed is on the outside.
    expect(thickLabels[target]).toBe(-1);
    compareDestination(thick, "land", thickLabels, 5 * 21, target);
    expect(walkDestination(thick, center(thick, 5 * 21), center(thick, target))).toEqual(center(thick, 10));
  });

  it("retains no-open-ground and nonwalkable/out-of-map goal fallbacks", () => {
    const water = testMap(["~~~", "~~~", "~~~"]);
    const goal = { x: 37.25, y: 45.75 };
    expect(walkDestination(water, { x: 16, y: 16 }, goal)).toEqual(goal);
    const map = testMap([".~~", "~~~", "~~."]);
    expect(walkDestination(map, center(map, 0), goal)).toEqual(goal);
    for (const point of [{ x: -1, y: 16 }, { x: 96, y: 16 }, { x: 16, y: -1 }, { x: 16, y: 96 }]) {
      expect(walkDestination(map, center(map, 0), point)).toEqual(point);
    }
  });
});
