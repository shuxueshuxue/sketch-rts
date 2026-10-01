import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateMap } from "./generated-map";
import { MAP_IDS } from "./map-ids";
import { MAP_POOL, type PoolMap, type PoolMapId } from "./map-pool";
import { createRoom, roomToGameSetup } from "./rooms";
import { createGame } from "./sim";

// @@@map-pool - Every pool map's whole layout, hashed: its ground, starts, mines, camps, posts, items, shops and
// obstacles. A change to the generator that moves anything on a pool map fails here; if the change is meant, the map is
// redrawn on purpose: give it a new name or take the new hash knowingly.
const HASHES: Record<PoolMapId, string> = {
  templeSpring: "d85534a8220c08f4",
  turtleLake: "0d1ffe4241e64c24",
  elderwood: "709656e76e88a120",
  ringwater: "21cd9f5efdc7a5b3",
  loneMarket: "edd81d6f144f60df",
  reedwater: "6d49111193f14075",
  veiledHill: "62928329e79e8f80",
  greystonePass: "55987a3d44b924c0",
  pineshade: "693e4158453223f3",
  gullIsland: "73b351045377b081",
  stillwater: "1f25159c96f514b5",
  twoShores: "0f8b67bcfe0003c8",
};

const host = { id: "host", name: "Host" };

// The map as a room on it would start it: the room's own seats and teams (see roomToGameSetup).
function seatsOf(map: PoolMap) {
  const room = createRoom({ id: `pool-${map.id}`, host, mapId: map.id as PoolMapId, humanCount: 1, aiCount: map.players - 1 });
  const { options } = roomToGameSetup(room);
  return { players: options.players!, teams: options.teams as Record<string, string> };
}

function layoutHash(map: PoolMap) {
  const { players, teams } = seatsOf(map);
  const drawn = generateMap(map.layout, players, teams);
  const at = (point: { x: number; y: number }) => `${point.x},${point.y}`;
  const text = JSON.stringify([
    drawn.size,
    drawn.terrain.cells,
    drawn.terrain.levels ?? "",
    drawn.starts,
    drawn.resources.map((mine) => `${at(mine)}:${mine.amount}`),
    drawn.units.filter((unit) => unit.owner === "neutral").map((unit) => `${unit.kind}@${at(unit)}`),
    drawn.mercenaryCamps.map((camp) => `${camp.hireKind}@${at(camp)}`),
    drawn.items.map((item) => `${item.kind}@${at(item)}`),
    drawn.sites.map((site) => `${site.kind}@${at(site)}`),
    // The rocks and gates, where a map has any (so the maps without keep their hashes).
    ...(drawn.obstacles.length > 0 ? [drawn.obstacles.map((obstacle) => `${obstacle.kind}@${at(obstacle)}`)] : []),
  ]);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

describe("map pool", () => {
  it("names every map once, in both languages, as a map id", () => {
    const ids = MAP_POOL.map((map) => map.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const map of MAP_POOL) {
      expect(MAP_IDS).toContain(map.id);
      expect(map.name.en.length).toBeGreaterThan(0);
      expect(map.name.zh.length).toBeGreaterThan(0);
    }
  });

  it("keeps every map exactly as it was drawn", () => {
    expect(Object.fromEntries(MAP_POOL.map((map) => [map.id, layoutHash(map)]))).toEqual(HASHES);
  });

  it("starts a room's game on its map's own layout, at the size it names", () => {
    for (const map of MAP_POOL as readonly PoolMap[]) {
      const { options } = roomToGameSetup(createRoom({ id: `game-${map.id}`, host, mapId: map.id as PoolMapId, humanCount: 1, aiCount: map.players - 1 }));
      const game = createGame(map.id as PoolMapId, options);
      if (map.layout.size) expect(game.map.width).toBe(map.layout.size);
      expect(game.buildings.filter((building) => building.kind === "townHall")).toHaveLength(map.players);
    }
  });
});
