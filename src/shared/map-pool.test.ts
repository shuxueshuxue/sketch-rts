import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateMap } from "./generated-map";
import { MAP_IDS } from "./map-ids";
import { MAP_POOL, type PoolMap, type PoolMapId } from "./map-pool";
import { createRoom, roomToGameSetup } from "./rooms";
import { createGame } from "./sim";

// @@@map-pool - Every pool map's whole layout, hashed: its ground, starts, mines, camps, posts, items, shops and
// obstacles. A change to the generator that moves anything on a pool map fails here; if the change is meant, the map is
// redrawn on purpose: give it a new name or take the new hash knowingly. Elderwood, ringwater and twoShores were redrawn so
// on 10-02: their islands' water widened (ISLAND_WATER 200 to 320, see generated-water), two deep cells to four or more.
const HASHES: Record<PoolMapId, string> = {
  templeSpring: "89d478ee42c291c3",
  turtleLake: "185a1f243b2bb342",
  elderwood: "ea14bcd697fe7b7c",
  ringwater: "b136207233416a3c",
  loneMarket: "e778910b1bf958d7",
  reedwater: "424d25fef7423cae",
  veiledHill: "1c6569d2777f6fba",
  greystonePass: "209985390ac9c00f",
  pineshade: "d21c2f7ceec5ee79",
  gullIsland: "193134cf3c39b45b",
  stillwater: "13f65932d0a0c499",
  twoShores: "767122ed94c74e7e",
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

it('keeps named shores and requested diplomacy when alliances are uneven or free-for-all', () => {
  for(const map of MAP_POOL.filter(map=>map.layout.kind==='sides')) {
    const {players,teams}=seatsOf(map);
    const baseline=createGame(map.id,{players,teams,aiPlayers:[]});
    for(const custom of [Object.fromEntries(players.map((p,i)=>[p,i===0?'a':'b'])),Object.fromEntries(players.map(p=>[p,p]))]) {
      const game=createGame(map.id,{players,teams:custom,aiPlayers:[]});
      expect(game.map.terrain?.cells).toBe(baseline.map.terrain?.cells);
      expect(game.teams).toEqual(custom);
      expect(game.buildings.filter(b=>b.kind==='townHall')).toHaveLength(4);
    }
  }
});
