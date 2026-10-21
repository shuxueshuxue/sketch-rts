import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import type { Mover, Terrain } from "./terrain";
import * as navigationAudit from "./navigation-audit";

type Point = { x: number; y: number };
type Field = { dist: Int32Array; next: Int32Array; used: number };
type State = {
  terrain: Terrain;
  width: number;
  walk: Uint8Array;
  weight: Uint8Array;
  fields: Map<number, Field>;
  spare: Field[];
  clock: number;
  tops: Int32Array;
};
type TerrainApi = {
  createRuntime(terrain: Terrain, mover: Mover): State;
  runtime(terrain: Terrain, mover: Mover): State;
  grow(state: State, sources: number[]): Field;
  exactField(state: State, target: number): Field;
  walkingDistance(map: { terrain: Terrain }, from: Point, goal: Point, mover?: Mover): number | undefined;
};

// This compiles the actual implementation with local test-only exports; production APIs and algorithms stay untouched.
const source = readFileSync(new URL("./terrain.ts", import.meta.url), "utf8");
const code = transformSync(`${source}\nexport { createRuntime, runtime, grow, exactField };`, {
  loader: "ts", format: "cjs", target: "es2022", sourcefile: "terrain.ts",
}).code;
const commonJs = { exports: {} };
new Function("module", "exports", "require", code)(commonJs, commonJs.exports, (specifier: string) => {
  if (specifier === "./navigation-audit") return navigationAudit;
  throw new Error(`Unexpected terrain dependency: ${specifier}`);
});
const terrainApi = commonJs.exports as TerrainApi;

const UNREACHED = 0x3fffffff;
const UNKNOWN = -2;
const terrain = (cols: number, rows: number, cells = ".".repeat(cols * rows)): Terrain => ({ cell: 32, cols, rows, cells });
const pad = (state: State, col: number, row: number) => (row + 1) * state.width + col + 1;
const point = (ground: Terrain, col: number, row: number): Point => ({ x: (col + 0.5) * ground.cell, y: (row + 0.5) * ground.cell });

// Off-map/padding/blocked cells are not valid public walkingDistance goals. Dedup also bounds the seed bucket by walk.length.
function validSources(state: State, sources: readonly number[]) {
  return [...new Set(sources.filter(at => Number.isInteger(at) && at >= 0 && at < state.walk.length && state.walk[at] === 1))];
}

function cellAt(ground: Terrain, state: State, target: Point) {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return -1;
  const col = Math.floor(target.x / ground.cell), row = Math.floor(target.y / ground.cell);
  return col < 0 || row < 0 || col >= ground.cols || row >= ground.rows ? -1 : pad(state, col, row);
}

// This is a proof fixture, not a production cache proposal. Copy each single field before a spare array can be reused.
function proveMinimum(state: State, requested: readonly number[]) {
  const sources = validSources(state, requested);
  const clock = state.clock;
  const fields = [...state.fields.entries()];
  const expected = new Int32Array(state.walk.length).fill(UNREACHED);
  const copies: Int32Array[] = [];
  for (const seed of sources) {
    const single = terrainApi.grow(state, [seed]);
    const copy = single.dist.slice();
    copies.push(copy);
    for (let at = 0; at < expected.length; at += 1) expected[at] = Math.min(expected[at]!, copy[at]!);
    // Only this uncached scratch field is recycled. No field still registered in the single-goal cache is put in spare.
    expect([...state.fields.values()]).not.toContain(single);
    state.spare.push(single);
  }
  const multiple = terrainApi.grow(state, sources);
  expect(Array.from(multiple.dist)).toEqual(Array.from(expected));
  expect(Array.from(multiple.next)).toEqual(Array(state.walk.length).fill(UNKNOWN));
  expect(Array.from(state.tops)).toEqual(Array(8).fill(0));
  expect(state.clock).toBe(clock);
  expect([...state.fields.entries()]).toEqual(fields);
  for (let at = 0; at < expected.length; at += 1) {
    expect(multiple.dist[at]).toBe(copies.reduce((minimum, copy) => Math.min(minimum, copy[at]!), UNREACHED));
  }
  return multiple;
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

describe("multi-source terrain distance proof without changing production", () => {
  it("equals the single-source minimum for tied sources, reordered/duplicate seeds and no seeds", () => {
    const state = terrainApi.createRuntime(terrain(9, 7), "land");
    const west = pad(state, 1, 3), east = pad(state, 7, 3), center = pad(state, 4, 3);
    const first = proveMinimum(state, [west, east]);
    expect(first.dist[center]).toBe(15);
    const before = first.dist.slice();
    expect(Array.from(proveMinimum(state, [east, west, east, west]).dist)).toEqual(Array.from(before));
    expect(Array.from(proveMinimum(state, []).dist)).toEqual(Array(state.walk.length).fill(UNREACHED));
  });

  it("filters blocked and off-map sources rather than assuming the private grow validates public goals", () => {
    const state = terrainApi.createRuntime(terrain(3, 1, ".T."), "land");
    const west = pad(state, 0, 0), blocked = pad(state, 1, 0), east = pad(state, 2, 0);
    const raw = terrainApi.grow(state, [blocked]);
    expect(raw.dist[west]).toBe(5);
    expect(raw.dist[east]).toBe(5);
    expect(terrainApi.walkingDistance({ terrain: state.terrain }, point(state.terrain, 0, 0), point(state.terrain, 1, 0))).toBeUndefined();
    const invalid = [blocked, -1, 0, state.walk.length, NaN, Infinity, 1.5];
    expect(Array.from(proveMinimum(state, invalid).dist)).toEqual(Array(state.walk.length).fill(UNREACHED));
    const result = proveMinimum(state, [west, ...invalid, west]);
    expect(result.dist[west]).toBe(0);
    expect(result.dist[east]).toBe(UNREACHED);
    // Normalization keeps a duplicate-heavy input within the existing fixed bucket capacity, with all real seeds intact.
    const expanded = Array(state.walk.length * 3).fill(west) as number[];
    expanded.push(east);
    expect(proveMinimum(state, expanded).dist[east]).toBe(0);
  });

  it("preserves disconnected land/sea, shoreline corners and map-edge sources", () => {
    const fixtures = [
      terrain(7, 5, ["..~..~.", "..~..~.", "~~,~~~~", ".~..~..", ".~..~.."].join("")),
      terrain(3, 3, [".T.", "T.T", ".T."].join("")),
      terrain(1, 7, ".~.~.~."),
      terrain(7, 1, ",~.#,~."),
      terrain(4, 4, "#".repeat(16)),
    ];
    for (const ground of fixtures) for (const mover of ["land", "sea"] as const) {
      const state = terrainApi.createRuntime(ground, mover);
      const open = Array.from(state.walk.keys()).filter(at => state.walk[at] === 1);
      proveMinimum(state, open.filter((_, index) => index % 2 === 0));
      proveMinimum(state, open.slice(0, 1));
      proveMinimum(state, open.slice(-2));
    }
  });

  it("uses uniform straight/diagonal 5/7 road length even on mud and shallow ground", () => {
    const copies: Int32Array[] = [];
    for (const char of [".", "m", ","]) {
      const state = terrainApi.createRuntime(terrain(8, 6, char.repeat(48)), "land");
      const field = proveMinimum(state, [pad(state, 0, 0), pad(state, 7, 5)]);
      expect(field.dist[pad(state, 1, 0)]).toBe(5);
      expect(field.dist[pad(state, 1, 1)]).toBe(7);
      copies.push(field.dist.slice());
    }
    expect(Array.from(copies[1]!)).toEqual(Array.from(copies[0]!));
    expect(Array.from(copies[2]!)).toEqual(Array.from(copies[0]!));
  });

  it("rebuilds the minimum for changed base-cell sets without corrupting a previously owned field", () => {
    const state = terrainApi.createRuntime(terrain(13, 9), "land");
    const a = pad(state, 0, 0), b = pad(state, 12, 8), c = pad(state, 6, 4);
    const retained = proveMinimum(state, [a, b]);
    const retainedCopy = retained.dist.slice();
    for (const sources of [[a], [b], [c], [a, c], [], [b, a, b]]) proveMinimum(state, sources);
    expect(Array.from(retained.dist)).toEqual(Array.from(retainedCopy));
  });

  it("matches public minimum walkingDistance with identical floating conversion and invalid-point semantics", () => {
    const ground = terrain(9, 6, ["...T.....", "...T.....", "...T.....", "...T.....", "...T.....", "........."].join(""));
    for (const mover of ["land", "sea"] as const) {
      const state = terrainApi.runtime(ground, mover);
      const bases = [point(ground, 0, 0), point(ground, 8, 4), point(ground, 3, 1), { x: -1, y: 32 }, { x: NaN, y: 32 }, { x: Infinity, y: 32 }];
      const field = proveMinimum(state, bases.map(base => cellAt(ground, state, base)));
      const targets = [
        ...Array.from({ length: ground.cols * ground.rows }, (_, at) => ({ ...point(ground, at % ground.cols, Math.floor(at / ground.cols)), x: point(ground, at % ground.cols, 0).x + 3.25 })),
        { x: -1, y: 32 }, { x: ground.cols * ground.cell, y: 32 }, { x: 32, y: NaN }, { x: 32, y: Infinity },
      ];
      for (const target of targets) {
        const at = cellAt(ground, state, target);
        const cost = at >= 0 && state.walk[at] === 1 ? field.dist[at]! : UNREACHED;
        const actual = cost >= UNREACHED ? Infinity : cost * ground.cell / 5;
        const expected = Math.min(Infinity, ...bases.map(base => terrainApi.walkingDistance({ terrain: ground }, target, base, mover) ?? Infinity));
        expect(actual).toBe(expected);
      }
    }
  });

  it("refreshes under the existing new-Terrain identity protocol while documenting in-place cells mutation", () => {
    const original = terrain(5, 3);
    const map = { terrain: original };
    const from = point(original, 0, 1), goal = point(original, 4, 1);
    const warm = terrainApi.runtime(original, "land");
    expect(terrainApi.walkingDistance(map, from, goal)).toBe(128);
    const before = proveMinimum(warm, [pad(warm, 4, 1)]).dist.slice();
    const changed = "..T..".repeat(3);
    original.cells = changed;
    // Existing runtime is keyed by object identity. Fixing this old mutable-input behavior is outside the candidate scope.
    expect(terrainApi.runtime(original, "land")).toBe(warm);
    expect(terrainApi.walkingDistance(map, from, goal)).toBe(128);
    expect(Array.from(proveMinimum(warm, [pad(warm, 4, 1)]).dist)).toEqual(Array.from(before));
    const replaced = { ...original };
    const fresh = terrainApi.runtime(replaced, "land");
    expect(fresh).not.toBe(warm);
    expect(terrainApi.walkingDistance({ terrain: replaced }, from, goal)).toBeUndefined();
    expect(proveMinimum(fresh, [pad(fresh, 4, 1)]).dist[pad(fresh, 0, 1)]).toBe(UNREACHED);
    const restored = { ...replaced, cells: ".".repeat(15) };
    const restoreState = terrainApi.runtime(restored, "land");
    expect(terrainApi.walkingDistance({ terrain: restored }, from, goal)).toBe(128);
    expect(proveMinimum(restoreState, [pad(restoreState, 4, 1)]).dist[pad(restoreState, 0, 1)]).toBe(20);
  });

  it("proves why a single cached field cannot be held as a stable getter buffer across LRU reuse", () => {
    const state = terrainApi.createRuntime(terrain(17, 17), "land");
    const source = pad(state, 0, 0);
    const borrowed = terrainApi.exactField(state, source);
    const borrowedCopy = borrowed.dist.slice();
    const owned = terrainApi.grow(state, [source, pad(state, 16, 16)]);
    const ownedCopy = owned.dist.slice();
    let recycled = false;
    for (let row = 0; row < 17; row += 1) for (let col = 0; col < 17; col += 1) {
      const at = pad(state, col, row);
      if (at === source) continue;
      const field = terrainApi.exactField(state, at);
      if (field === borrowed) recycled = true;
    }
    expect(recycled).toBe(true);
    expect(Array.from(borrowed.dist)).not.toEqual(Array.from(borrowedCopy));
    expect(Array.from(owned.dist)).toEqual(Array.from(ownedCopy));
    expect([...state.fields.values()]).not.toContain(owned);
    expect(Array.from(terrainApi.exactField(state, source).dist)).toEqual(Array.from(borrowedCopy));
    expect(state.fields.size).toBe(128);
  });

  it("matches 500 deterministic random terrain/source cases using copied single-source oracles", () => {
    const random = randomNumbers(0x945e37a1);
    const chars = [".", ".", "m", ",", "~", "T", "#"];
    for (let sample = 0; sample < 500; sample += 1) {
      const cols = 1 + random(16), rows = 1 + random(14);
      const ground = terrain(cols, rows, Array.from({ length: cols * rows }, () => chars[random(chars.length)]!).join(""));
      const state = terrainApi.createRuntime(ground, sample % 2 ? "land" : "sea");
      const requested = Array.from({ length: random(10) }, () => random(state.walk.length));
      requested.push(-1, state.walk.length, NaN, ...requested.slice(0, 2));
      proveMinimum(state, requested);
    }
  });
});
