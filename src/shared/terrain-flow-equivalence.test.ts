import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import type { Mover, Terrain } from "./terrain";

type Box = { left: number; top: number; width: number; height: number };
type Arrays = { dist: Int32Array; next: Int32Array };
type Field = Arrays & { box: Box };
type FlowState = {
  terrain: Terrain;
  width: number;
  walk: Uint8Array;
  weight: Uint8Array;
  offsets: Int32Array;
  boxBuckets: number[][];
};
type FlowApi = {
  createRuntime(terrain: Terrain, mover: Mover): FlowState;
  growBoxInto(state: FlowState, box: Box, seeds: number[], costs: number[] | undefined, arrays: Arrays): Field;
};

// Compile the actual private implementation with test-only exports. Shipping terrain.ts gains no testing API.
// Terrain has only type imports, so this local CommonJS test bundle needs no module loader or environment mocks.
const source = readFileSync(new URL("./terrain.ts", import.meta.url), "utf8");
const compiled = transformSync(`${source}\nexport { createRuntime, growBoxInto };`, {
  loader: "ts", format: "cjs", target: "es2022", sourcefile: "terrain.ts",
}).code;
const commonJs = { exports: {} };
new Function("module", "exports", compiled)(commonJs, commonJs.exports);
const production = commonJs.exports as FlowApi;

const UNREACHED = 0x3fffffff;
const UNKNOWN = -2;
const BUCKETS = 64;
const STEP_COLS = [1, 0, -1, 0, 1, -1, -1, 1];
const STEP_ROWS = [0, 1, 0, -1, 1, 1, -1, -1];

function referenceLocal(box: Box, at: number, width: number) {
  const col = at % width;
  const row = (at - col) / width;
  if (col < box.left || row < box.top || col >= box.left + box.width || row >= box.top + box.height) return -1;
  return (row - box.top) * box.width + (col - box.left);
}

function referenceStepAllowed(state: FlowState, at: number, direction: number) {
  if (direction < 4) return true;
  const { walk, width } = state;
  const dx = direction === 4 || direction === 7 ? 1 : -1;
  const dy = direction === 4 || direction === 5 ? width : -width;
  return walk[at + dx] === 1 && walk[at + dy] === 1;
}

// Frozen pre-mask loop: preserve seed sorting, full per-neighbour bounds checks and bucket LIFO as the oracle.
function referenceGrowBoxInto(state: FlowState, box: Box, seeds: number[], costs: number[] | undefined, arrays: Arrays): Field {
  const { walk, offsets, width, weight } = state;
  const columns = box.width;
  const rows = box.height;
  const origin = box.top * width + box.left;
  const { dist, next } = arrays;
  dist.fill(UNREACHED);
  next.fill(UNKNOWN);
  const buckets = state.boxBuckets;
  const order = seeds.map((_, index) => index);
  if (costs) order.sort((a, b) => costs[a]! - costs[b]! || a - b);
  const costOf = (index: number) => (costs ? costs[order[index]!]! : 0);
  let seeded = 0;
  let pending = 0;
  for (let cost = order.length > 0 ? costOf(0) : 0; pending > 0 || seeded < order.length; cost += 1) {
    if (pending === 0) cost = costOf(seeded);
    for (; seeded < order.length && costOf(seeded) === cost; seeded += 1) {
      const index = referenceLocal(box, seeds[order[seeded]!]!, width);
      if (index < 0 || cost >= dist[index]!) continue;
      dist[index] = cost;
      buckets[cost % BUCKETS]!.push(index);
      pending += 1;
    }
    const bucket = buckets[cost % BUCKETS]!;
    while (bucket.length > 0) {
      const index = bucket.pop()!;
      pending -= 1;
      if (dist[index] !== cost) continue;
      const col = index % columns;
      const row = (index - col) / columns;
      const at = origin + row * width + col;
      for (let direction = 0; direction < 8; direction += 1) {
        const stepCol = col + STEP_COLS[direction]!;
        const stepRow = row + STEP_ROWS[direction]!;
        if (stepCol < 0 || stepRow < 0 || stepCol >= columns || stepRow >= rows) continue;
        const step = at + offsets[direction]!;
        if (walk[step] !== 1) continue;
        const there = stepRow * columns + stepCol;
        const reached = cost + (direction < 4 ? 5 : 7) * weight[step]!;
        if (reached >= dist[there]! || !referenceStepAllowed(state, at, direction)) continue;
        dist[there] = reached;
        buckets[reached % BUCKETS]!.push(there);
        pending += 1;
      }
    }
  }
  return { box, dist, next };
}

type BucketEvent = ["push" | "pop", number, number | undefined];

function recordBuckets(state: FlowState) {
  const trace: BucketEvent[] = [];
  for (const [slot, bucket] of state.boxBuckets.entries()) {
    bucket.push = function (this: number[], ...items: number[]) {
      for (const item of items) trace.push(["push", slot, item]);
      return Array.prototype.push.apply(this, items);
    };
    bucket.pop = function (this: number[]) {
      const value = Array.prototype.pop.call(this) as number | undefined;
      trace.push(["pop", slot, value]);
      return value;
    };
  }
  return trace;
}

function fixture(cols: number, rows: number, cells = ".".repeat(cols * rows)): Terrain {
  return { cell: 32, cols, rows, cells };
}

const pad = (state: FlowState, col: number, row: number) => (row + 1) * state.width + col + 1;
const fieldArrays = (box: Box): Arrays => ({
  dist: new Int32Array(box.width * box.height).fill(-771),
  next: new Int32Array(box.width * box.height).fill(912),
});

function states(terrain: Terrain, mover: Mover) {
  const actual = production.createRuntime(terrain, mover);
  const reference = production.createRuntime(terrain, mover);
  return { actual, reference, actualTrace: recordBuckets(actual), referenceTrace: recordBuckets(reference) };
}

function compareFields(pair: ReturnType<typeof states>, box: Box, seeds: number[], costs?: number[], arrays?: { actual: Arrays; reference: Arrays }) {
  pair.actualTrace.length = 0;
  pair.referenceTrace.length = 0;
  const actualArrays = arrays?.actual ?? fieldArrays(box);
  const referenceArrays = arrays?.reference ?? fieldArrays(box);
  const actual = production.growBoxInto(pair.actual, box, seeds, costs, actualArrays);
  const reference = referenceGrowBoxInto(pair.reference, box, seeds, costs, referenceArrays);
  expect(actual.box).toBe(box);
  expect(actual.dist).toBe(actualArrays.dist);
  expect(actual.next).toBe(actualArrays.next);
  expect(Array.from(actual.dist)).toEqual(Array.from(reference.dist));
  expect(Array.from(actual.next)).toEqual(Array.from(reference.next));
  expect(pair.actualTrace).toEqual(pair.referenceTrace);
  expect(pair.actual.boxBuckets.map(bucket => bucket.length)).toEqual(Array(BUCKETS).fill(0));
  expect(pair.reference.boxBuckets.map(bucket => bucket.length)).toEqual(Array(BUCKETS).fill(0));
  return actual;
}

function randomNumbers(seed: number) {
  let value = seed >>> 0;
  return (limit: number) => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) % limit;
  };
}

describe("terrain box floods preserve every field cell and bucket operation", () => {
  it("preserves all eight directions and forbids each blocked orthogonal corner", () => {
    const pair = states(fixture(3, 3), "land");
    const box = { left: 1, top: 1, width: 3, height: 3 };
    const seed = pad(pair.actual, 1, 1);
    const full = compareFields(pair, box, [seed]);
    expect(Array.from(full.dist)).toEqual([28, 20, 28, 20, 0, 20, 28, 20, 28]);
    for (const direction of [0, 1, 2, 3]) {
      const blocked = seed + pair.actual.offsets[direction]!;
      pair.actual.walk[blocked] = pair.reference.walk[blocked] = 0;
      compareFields(pair, box, [seed]);
      pair.actual.walk[blocked] = pair.reference.walk[blocked] = 1;
    }
    const corner = states(fixture(2, 2, ".T.."), "land");
    const result = compareFields(corner, { left: 1, top: 1, width: 2, height: 2 }, [pad(corner.actual, 0, 0)]);
    expect(result.dist[3]).toBe(40);
  });

  it("preserves width/height one, physical edges, padded borders and nonorigin boxes", () => {
    const terrain = fixture(13, 11);
    const pair = states(terrain, "land");
    const boxes = [
      { left: 1, top: 1, width: 1, height: 1 },
      { left: 1, top: 1, width: 1, height: 11 },
      { left: 1, top: 5, width: 13, height: 1 },
      { left: 13, top: 1, width: 1, height: 11 },
      { left: 1, top: 11, width: 13, height: 1 },
      { left: 4, top: 3, width: 7, height: 5 },
      { left: 0, top: 0, width: pair.actual.width, height: terrain.rows + 2 },
    ];
    for (const box of boxes) {
      const seed = box.top * pair.actual.width + box.left;
      compareFields(pair, box, [seed]);
      compareFields(pair, box, [seed + (box.height - 1) * pair.actual.width + box.width - 1]);
      compareFields(pair, box, []);
    }
  });

  it("preserves entering mud/shallow weights and land/sea passability", () => {
    const terrain = fixture(9, 6, [".........", "..mmm,...", "..T#m,...", "..~,,,...", "..~=~....", "........."].join(""));
    for (const mover of ["land", "sea"] as const) {
      const pair = states(terrain, mover);
      const box = { left: 1, top: 1, width: terrain.cols, height: terrain.rows };
      const open = Array.from(pair.actual.walk.keys()).filter(at => pair.actual.walk[at] === 1);
      for (const seed of open) compareFields(pair, box, [seed]);
    }
    const mud = states(fixture(3, 1, ".m,"), "land");
    const result = compareFields(mud, { left: 1, top: 1, width: 3, height: 1 }, [pad(mud.actual, 0, 0)]);
    expect(Array.from(result.dist)).toEqual([0, 35, 60]);
  });

  it("preserves ordered/equal seed costs, duplicates, outside seeds and unreachable seed costs", () => {
    const pair = states(fixture(12, 10), "land");
    const box = { left: 3, top: 2, width: 7, height: 6 };
    const seeds = [pad(pair.actual, 2, 1), pad(pair.actual, 8, 6), pad(pair.actual, 5, 4)];
    compareFields(pair, box, seeds);
    compareFields(pair, box, seeds, [200, 0, 200]);
    compareFields(pair, box, seeds, [19, 19, 19]);
    compareFields(pair, box, [seeds[0]!, seeds[0]!, seeds[1]!], [64, 0, 128]);
    compareFields(pair, box, [seeds[0]!, seeds[1]!], [UNREACHED, UNREACHED]);
    compareFields(pair, box, [0, -1, pair.actual.walk.length, pad(pair.actual, 11, 9), ...seeds], [0, 4, 17, 30, 40, 0, 1]);
  });

  it("refills reused arrays and drains buckets after repeated obstruction changes", () => {
    const pair = states(fixture(12, 10), "land");
    const box = { left: 1, top: 1, width: 12, height: 10 };
    const arrays = { actual: fieldArrays(box), reference: fieldArrays(box) };
    const seed = pad(pair.actual, 2, 3);
    for (let revision = 0; revision < 12; revision += 1) {
      arrays.actual.next.fill(revision + 100);
      arrays.reference.next.fill(revision + 100);
      for (let row = 0; row < 10; row += 1) {
        const at = pad(pair.actual, 6, row);
        pair.actual.walk[at] = pair.reference.walk[at] = revision % 3 === 0 ? 1 : 0;
      }
      compareFields(pair, box, [seed], undefined, arrays);
    }
  });

  it("matches 400 seeded random boxes, movers, weighted terrain and multiseed costs", () => {
    const random = randomNumbers(0x754d06c1);
    const chars = [".", ".", ".", "m", ",", "~", "T", "#"];
    for (let sample = 0; sample < 400; sample += 1) {
      const cols = 1 + random(18), rows = 1 + random(16);
      const cells = Array.from({ length: cols * rows }, () => chars[random(chars.length)]!).join("");
      const pair = states(fixture(cols, rows, cells), sample % 2 ? "land" : "sea");
      const left = random(cols + 2), top = random(rows + 2);
      const box = { left, top, width: 1 + random(cols + 2 - left), height: 1 + random(rows + 2 - top) };
      const seeds = Array.from({ length: random(7) }, () => random(pair.actual.walk.length + pair.actual.width));
      const costs = sample % 3 ? undefined : seeds.map(() => random(6) * 17);
      compareFields(pair, box, seeds, costs);
    }
  });
});
