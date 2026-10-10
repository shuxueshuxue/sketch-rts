import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateMap } from "./generated-map";
import { MAP_IDS } from "./map-ids";
import { MAP_POOL, type PoolMap, type PoolMapId } from "./map-pool";
import { createRoom, roomToGameSetup } from "./rooms";
import { createGame } from "./sim";
import { TIER_LEVELS, campLevel } from "./camps";
import type { CreepFamilyUnitKind } from "./types";
import {isWalkable,sameGround} from './terrain';

// @@@map-pool - Every pool map's whole layout, hashed: its ground, starts, mines, camps, posts, items, shops and
// obstacles. A change to the generator that moves anything on a pool map fails here; if the change is meant, the map is
// redrawn on purpose: give it a new name or take the new hash knowingly.
// 10-07: organic island coastlines and continuous-environment creep habitats replace periodic stamps. Elderwood, ringwater and twoShores were redrawn so
// on 10-02: their islands' water widened (ISLAND_WATER 200 to 320, see generated-water), two deep cells to four or more.
// 10-08: main mines preserve a 288-unit haul after hall snapping; new halls require 280 units.
// Island and hill mine sites now leave room for that ordinary construction rule.
// 10-09: eleven naval layouts gain larger bounds, broader channels and more ocean
// between islands for the enlarged fleet. Their authored economics keep the same mine counts.
// Mineral isles and expansion clearings now include complete hauling foundations
// and worker access around all four walls; named map bounds and mine counts stay fixed.
// 10-09 follow-up: minimum hall distance 210 and all snapped initial hauling lanes
// exactly 216; the shorter mineral offset also updates protected terrain around mains.
// Prepared mineral courtyards stay dry in mire layouts; reedwater retains mud outside them.
const HASHES: Record<PoolMapId, string> = {
  sapphireArchipelago:'b6703a780998228c',
  grandEstuary:'f61173bfe2528d83',
  brokenSea: "ccf2b2d83de2b3e1",
  templeSpring: "573bc1e6dd39e87f",
  turtleLake: "57468c4991eaf724",
  elderwood: "2421b993970b6212",
  ringwater: "8ea4e0320581a02b",
  loneMarket: "ba20d16b14e5104b",
  reedwater: "2a97d95f469f461e",
  veiledHill: "b2c80d16362a59cc",
  greystonePass: "f9a7a649d1d05728",
  pineshade: "502472ad7ac76b35",
  gullIsland: "2be7184ae9b2ba29",
  stillwater: "e67ba5ef77911369",
  twoShores: "db5e5da96cbefa5a",
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

it('opens every resource and camp on the six/eight player maps, with useful distinct theaters',()=>{
 for(const id of ['sapphireArchipelago','grandEstuary'] as const){
  const map=MAP_POOL.find(map=>map.id===id)!,{players,teams}=seatsOf(map),game=createGame(id,{players,teams,aiPlayers:[]});
  expect(game.map.terrain!.ecology).toMatchObject({version:1,seed:map.layout.seed});
  expect(game.map.terrain!.surfaces).toBeUndefined();
  for(const point of [...game.resources,...game.units,...game.buildings])expect(isWalkable(game.map,point.x,point.y),`${id}: ${point.id}`).toBe(true);
  const homes=game.buildings.filter(building=>building.kind==='townHall');
  if(id==='grandEstuary')for(const home of homes)expect(sameGround(game.map,homes[0]!,home)).toBe(true);
  else for(const home of homes.slice(1))expect(sameGround(game.map,homes[0]!,home)).toBe(false);
  expect(game.map.landmarks.length).toBeGreaterThan(80);
 }
});

it('keeps named shores and requested diplomacy when alliances are uneven or free-for-all', () => {
  for(const map of MAP_POOL.filter(map=>map.layout.kind==='sides')) {
    const {players,teams}=seatsOf(map);
    const baseline=createGame(map.id,{players,teams,aiPlayers:[]});
    for(const custom of [Object.fromEntries(players.map((p,i)=>[p,i===0?'a':'b'])),Object.fromEntries(players.map(p=>[p,p]))]) {
      const game=createGame(map.id,{players,teams:custom,aiPlayers:[]});
      expect(game.map.terrain?.cells).toBe(baseline.map.terrain?.cells);
      expect(game.teams).toEqual(custom);
      expect(game.buildings.filter(b=>b.kind==='townHall')).toHaveLength(map.players);
    }
  }
});


it('guards expansion gold with complete tiered camps, equally strong for every starting seat', () => {
  for (const id of ['sapphireArchipelago', 'grandEstuary'] as const) {
    const map = MAP_POOL.find(map => map.id === id)!, { players, teams } = seatsOf(map);
    for (const seed of [map.layout.seed, 'expansion-camps-alternate']) {
      const drawn = generateMap({ ...map.layout, seed }, players, teams);
      const neutral = drawn.units.filter(unit => unit.owner === 'neutral');
      for (const camp of drawn.camps) {
        const members = neutral.filter(unit => Math.hypot(unit.x - camp.x, unit.y - camp.y) < 100);
        expect(members.length).toBeGreaterThanOrEqual(2);
        const power = campLevel(members.map(unit => unit.kind as CreepFamilyUnitKind));
        expect(power).toBeGreaterThanOrEqual(TIER_LEVELS[camp.tier].min);
        expect(power).toBeLessThanOrEqual(TIER_LEVELS[camp.tier].max);
        expect(drawn.resources.some(mine => Math.hypot(mine.x - camp.x, mine.y - camp.y) < 250)).toBe(true);
      }
      for (const mine of drawn.resources) {
        if (mine.id.endsWith('-main')) {
          expect(neutral.every(unit => Math.hypot(unit.x - mine.x, unit.y - mine.y) > 500)).toBe(true);
        } else expect(drawn.camps.some(camp => Math.hypot(camp.x - mine.x, camp.y - mine.y) < 250)).toBe(true);
      }
      for (const tier of ['orange', 'red'] as const) {
        const rosters = drawn.camps.filter(camp => camp.tier === tier).map(camp => neutral.filter(unit => Math.hypot(unit.x - camp.x, unit.y - camp.y) < 100).map(unit => unit.kind));
        expect(rosters.every(roster => JSON.stringify(roster) === JSON.stringify(rosters[0]))).toBe(true);
      }
    }
  }
});
