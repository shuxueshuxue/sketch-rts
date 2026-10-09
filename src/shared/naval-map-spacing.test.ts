import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from './catalog';
import { isBuildPlacementClear } from './build-placement';
import { detCos, detSin } from './det-math';
import { generateMap } from './generated-map';
import { createBuilding, createUnit } from './map';
import { MAP_POOL } from './map-pool';
import { GOLD_MINE_RULES } from './mining';
import { createRoom, roomToGameSetup } from './rooms';
import { shipLaunchPose } from './ship-launch';
import { hullFits, hullPassageClear, type ShipPose } from './ship-navigation';
import { isFootprintBuildable, isWalkable, sameGround, shoreSpots, snapToFootprint, walkableGoal } from './terrain';
import type { GameMap, Unit } from './types';

const NAVAL_LAYOUTS = [
  ['sapphireArchipelago', 10240, 18], ['grandEstuary', 10240, 24],
  ['brokenSea', 7680, 12], ['templeSpring', 6656, 16],
  ['turtleLake', 6144, 13], ['elderwood', 7168, 16],
  ['ringwater', 6656, 16], ['loneMarket', 6656, 6],
  ['gullIsland', 6656, 9], ['stillwater', 7168, 12],
  ['twoShores', 7168, 15],
] as const;

function turningBasin(map: GameMap, ship: Unit, launch: ShipPose) {
  const turns = Array.from({ length: 8 }, (_, i) => i*Math.PI/4);
  for (let reach = 64; reach <= 768; reach += 64) {
    for (let spoke = 0; spoke < 16; spoke++) {
      const angle = spoke*Math.PI/8;
      const at = { x: launch.x+detCos(angle)*reach, y: launch.y+detSin(angle)*reach, heading: launch.heading };
      if (!hullFits(map, ship, at) || !sameGround(map, launch, at, 'sea')) continue;
      if (!hullPassageClear(map, ship, launch, at)) continue;
      if (turns.every(heading => hullPassageClear(map, ship, {...at, heading}, {...at, heading: heading+Math.PI/4}))) return at;
    }
  }
  return undefined;
}

describe('larger naval map spacing', () => {
  it.each(NAVAL_LAYOUTS)('%s preserves its economy and gives every home a complete large-hull harbor', (id, size, mineCount) => {
    const spec = MAP_POOL.find(map => map.id === id)!;
    const { options } = roomToGameSetup(createRoom({ id:`spacing-${id}`, host:{id:'host',name:'Host'}, mapId:id, humanCount:1, aiCount:spec.players-1 }));
    const drawn = generateMap(spec.layout, options.players!, options.teams as Record<string,string>);
    const map: GameMap = { id, name:spec.name.en, width:drawn.size, height:drawn.size, terrain:drawn.terrain, landmarks:drawn.landmarks };
    expect(drawn.size).toBe(size);
    expect(drawn.terrain.cell).toBe(32);
    expect(drawn.resources).toHaveLength(mineCount);
    for (const point of [...drawn.resources, ...drawn.units, ...drawn.buildings, ...drawn.sites])
      expect(isWalkable(map, point.x, point.y), `${id}: ${'id' in point ? point.id : point.kind}`).toBe(true);
    for (const mine of drawn.resources.filter(mine => !mine.id.endsWith('-main'))) {
      const sites = [288, 304, 320].flatMap(reach => Array.from({length:32}, (_,spoke) => {
        const angle = spoke*Math.PI/16;
        return snapToFootprint(map, BUILDING_DEFS.townHall.radius, {x:mine.x+detCos(angle)*reach,y:mine.y+detSin(angle)*reach});
      }));
      expect(sites.some(site => Math.hypot(site.x-mine.x,site.y-mine.y) <= GOLD_MINE_RULES.baseRange
        && sameGround(map,site,mine)
        && isBuildPlacementClear({map,buildings:drawn.buildings,resources:drawn.resources,obstacles:drawn.obstacles},'townHall',site)),`${id}: ${mine.id} needs a legal hauling hall`).toBe(true);
    }
    const shores = shoreSpots(map, BUILDING_DEFS.shipyard.radius);
    for (const hall of drawn.buildings) {
      const main = drawn.resources.find(resource => resource.id === `gold-${hall.owner}-main`)!;
      expect(sameGround(map, hall, main)).toBe(true);
      expect(Math.abs(Math.hypot(main.x-hall.x,main.y-hall.y)-GOLD_MINE_RULES.mainDistance)).toBeLessThan(32);
      expect(isFootprintBuildable(map, hall.x, hall.y, BUILDING_DEFS.townHall.radius)).toBe(true);
      const ship = createUnit(`line-${hall.owner}`, hall.owner, 'shipOfTheLine', hall.x, hall.y);
      const yards = shores.filter(point => Math.hypot(point.x-hall.x,point.y-hall.y) < 4000
        && sameGround(map, hall, walkableGoal(map, point.x, point.y, 'land')))
        .sort((a,b) => Math.hypot(a.x-hall.x,a.y-hall.y)-Math.hypot(b.x-hall.x,b.y-hall.y));
      let harbor: ShipPose | undefined;
      for (const point of yards.slice(0,64)) {
        const dock = createBuilding(`yard-${hall.owner}`, hall.owner, 'shipyard', point.x, point.y, true);
        const launch = shipLaunchPose({ map, units:drawn.units, buildings:[...drawn.buildings,dock], obstacles:drawn.obstacles }, dock, ship);
        if (launch && turningBasin(map, ship, launch)) { harbor=launch; break; }
      }
      expect(harbor, `${id}: ${hall.owner} must launch and turn a whole enlarged ship of the line`).toBeDefined();
    }
  });
});
