import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateMap } from "./generated-map";
import { MAP_IDS } from "./map-ids";
import { MAP_POOL, type PoolMap, type PoolMapId } from "./map-pool";
import { createRoom, roomToGameSetup } from "./rooms";
import { createGame } from "./sim";

// @@@map-pool - Every pool map's whole layout, hashed: its ground, starts, mines, camps, posts and items. A change to the
// generator that moves anything on a pool map fails here; if the change is meant, the map is redrawn on purpose: give it
// a new name or take the new hash knowingly.
const HASHES: Record<PoolMapId, string> = {
  greystonePass: "406d0ee7843017eb",
  stillwater: "87d594feac15cfe6",
  pineshade: "78a188b492ace36d",
  shatteredBarrens: "5a9eb7d99d05fd86",
  reedwater: "384f483fb3d55ccb",
  saltmarshIsle: "bdf761cda03959d2",
  mirrorLagoon: "8cdf6c0b6caa8ef5",
  fourWinds: "3316e04c851a6c65",
  elderwood: "755e07c5eabe48c9",
  lakelands: "90b6cc63cf72be50",
  ironcrag: "c2563a6a923cc416",
  inlandSea: "0f81cff6200ddf32",
  gullIsland: "df9dc46ab881ef56",
  twoShores: "679db12345a9057c",
  cliffbreak: "b7919adb26682fbf",
  battlelineFields: "3e76305d69225df2",
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
