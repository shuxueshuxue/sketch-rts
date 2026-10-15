import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import type { Terrain } from "./terrain";

type Point = { x: number; y: number };
type Body = Point & { radius: number };
type MapLike = { terrain: Terrain; width: number; height: number };
type BoxField = { box: { left: number; top: number; width: number; height: number }; dist: Int32Array };
type TileNode = { key: number; sector: number; cells: number[]; across: number; field: BoxField; edges: { to: number; cost: number }[] };
type Tiles = { columns: number; rows: number; nodes: Map<number, TileNode>; borders: Map<number, number[]>; region: Int32Array; island: Int32Array };
type State = { walk: Uint8Array; clearance?: Uint16Array; tiles?: Tiles };
type TerrainApi = {
  overlays: WeakMap<object, { state: State; shared: boolean }>;
  tilesOf(state: State): Tiles;
  fillClearance(state: State): void;
  setBuildingBodies(map: MapLike, bodies: readonly Body[]): void;
  shareBuildingBodies(source: object, target: object): void;
  steerPoint(map: MapLike, from: Point, goal: Point): Point;
  walkDestination(map: MapLike, from: Point, goal: Point): Point;
  segmentWalkable(map: MapLike, a: Point, b: Point): boolean;
};

// The actual implementation with test-only exports of its private copy state.
const source = readFileSync(new URL("./terrain.ts", import.meta.url), "utf8");
const code = transformSync(`${source}\nexport { overlays, tilesOf, fillClearance };`, {
  loader: "ts", format: "cjs", target: "es2022", sourcefile: "terrain.ts",
}).code;
const commonJs = { exports: {} };
new Function("module", "exports", code)(commonJs, commonJs.exports);
const api = commonJs.exports as TerrainApi;

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function landMap(cols: number, rows: number, next: () => number): MapLike {
  let cells = "";
  for (let at = 0; at < cols * rows; at += 1) {
    const roll = next();
    cells += roll < 0.06 ? "T" : roll < 0.1 ? "~" : roll < 0.14 ? "m" : roll < 0.16 ? "," : ".";
  }
  const terrain = { cell: 32, cols, rows, cells };
  return { terrain, width: cols * 32, height: rows * 32 };
}

function bodiesOf(map: MapLike, count: number, next: () => number): Body[] {
  return Array.from({ length: count }, () => ({
    x: Math.floor(next() * map.terrain.cols) * 32 + 16,
    y: Math.floor(next() * map.terrain.rows) * 32 + 16,
    radius: [16, 40, 48, 72][Math.floor(next() * 4)]!,
  }));
}

// Every routing answer the tiles hold, in key order: regions, islands, window sides with their fields and edges.
function tilesFacts(tiles: Tiles) {
  return {
    region: Array.from(tiles.region),
    island: Array.from(tiles.island),
    borders: [...tiles.borders].sort(([a], [b]) => a - b),
    nodes: [...tiles.nodes.values()].sort((a, b) => a.key - b.key).map((node) => ({
      key: node.key, sector: node.sector, cells: node.cells, across: node.across, edges: node.edges,
      box: node.field.box, dist: Array.from(node.field.dist),
    })),
  };
}

function overlayState(map: MapLike) {
  return api.overlays.get(map)!.state;
}

describe("a building change after a snapshot shared the building copy", () => {
  it("continues from a private copy whose redone tiles equal a fresh build, leaving the snapshot's copy intact", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const next = random(seed);
      const map = landMap(37, 29, next);
      const before = bodiesOf(map, 4 + Math.floor(next() * 6), next);
      api.setBuildingBodies(map, before);
      // The tiles and clearance a walk builds on its first look.
      const shared = overlayState(map);
      api.tilesOf(shared);
      api.fillClearance(shared);
      const sharedFacts = tilesFacts(shared.tiles!);
      const sharedWalk = Array.from(shared.walk);
      const sharedClearance = Array.from(shared.clearance!);

      const snapshot = { ...map };
      api.shareBuildingBodies(map, snapshot);
      const after = [...before.slice(1), ...bodiesOf(map, 1 + Math.floor(next() * 3), next)];
      api.setBuildingBodies(map, after);
      const copy = overlayState(map);
      expect(copy).not.toBe(shared);
      expect(copy.tiles).toBeDefined();

      // A fresh building copy of the same buildings, its tiles built from nothing.
      const fresh = { ...map, terrain: map.terrain };
      api.setBuildingBodies(fresh, after);
      const reference = overlayState(fresh);
      expect(reference).not.toBe(copy);
      expect(Array.from(copy.walk)).toEqual(Array.from(reference.walk));
      expect(tilesFacts(copy.tiles!)).toEqual(tilesFacts(api.tilesOf(reference)));
      api.fillClearance(reference);
      expect(Array.from(copy.clearance!)).toEqual(Array.from(reference.clearance!));

      // The snapshot still reads its own buildings' routing, untouched.
      expect(overlayState(snapshot)).toBe(shared);
      expect(Array.from(shared.walk)).toEqual(sharedWalk);
      expect(Array.from(shared.clearance!)).toEqual(sharedClearance);
      expect(tilesFacts(shared.tiles!)).toEqual(sharedFacts);

      // Walks on both copies answer as fresh builds of their own buildings do.
      const old = { ...map, terrain: map.terrain };
      api.setBuildingBodies(old, before);
      for (let probe = 0; probe < 40; probe += 1) {
        const a = { x: next() * map.width, y: next() * map.height }, b = { x: next() * map.width, y: next() * map.height };
        expect(api.steerPoint(map, a, b)).toEqual(api.steerPoint(fresh, a, b));
        expect(api.walkDestination(map, a, b)).toEqual(api.walkDestination(fresh, a, b));
        expect(api.steerPoint(snapshot, a, b)).toEqual(api.steerPoint(old, a, b));
        expect(api.walkDestination(snapshot, a, b)).toEqual(api.walkDestination(old, a, b));
      }
    }
  });
});
