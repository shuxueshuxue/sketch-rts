import { describe, expect, it } from 'vitest';
import { buildingPlacementBlocker, terrainBlocksPlacement } from './build-placement';
import { BUILDING_DEFS, UNIT_DEFS } from './catalog';
import { BUILDING_WORK_REACH } from './construction';
import { createUnit } from './map';
import { MAP_POOL } from './map-pool';
import { GOLD_MINE_RULES } from './mining';
import { createRoom, roomToGameSetup } from './rooms';
import { createGame, issueCommand, stepGame, type Game } from './sim';
import { footprintHalf, isFootprintBuildable, isOpenGround, segmentWalkable, setBuildingBodies, snapToFootprint } from './terrain';
import { seconds } from './time';
import type { ResourceNode } from './types';

type Point = { x:number; y:number };

const HALL_RADIUS = BUILDING_DEFS.townHall.radius;
const WORKER_RADIUS = UNIT_DEFS.worker.radius;
const ECONOMY: Record<(typeof MAP_POOL)[number]['id'], readonly [number,number]> = {
  sapphireArchipelago:[10240,18], grandEstuary:[10240,24], brokenSea:[7680,12],
  templeSpring:[6656,16], turtleLake:[6144,13], elderwood:[7168,16],
  ringwater:[6656,16], loneMarket:[6656,6], reedwater:[5120,6],
  veiledHill:[4608,7], greystonePass:[4608,6], pineshade:[4608,7],
  gullIsland:[6656,9], stillwater:[7168,12], twoShores:[7168,15],
};

function poolGame(id: (typeof MAP_POOL)[number]['id']) {
  const spec = MAP_POOL.find(map => map.id === id)!;
  const { options } = roomToGameSetup(createRoom({ id:`gold-${id}`, host:{id:'host',name:'Host'}, mapId:id, humanCount:1, aiCount:spec.players-1 }));
  const game = createGame(id, { ...options, aiPlayers:[] });
  setBuildingBodies(game.map, [...game.buildings, ...(game.obstacles ?? [])]);
  return game;
}

function workerFits(game: Game, at: Point) {
  // The center-only navigation query is supplemented with the worker's body.
  const r = WORKER_RADIUS, diagonal = r / Math.SQRT2;
  return [[0,0],[-r,0],[r,0],[0,-r],[0,r],[-diagonal,-diagonal],[-diagonal,diagonal],[diagonal,-diagonal],[diagonal,diagonal]]
    .every(([x,y]) => isOpenGround(game.map, at.x+x!, at.y+y!));
}

function mineEntrance(game: Game, mine: ResourceNode, hall: Point) {
  const cell = game.map.terrain!.cell, half = footprintHalf(HALL_RADIUS, cell), offset = half+cell/2;
  for (const [x,y] of [[-offset,0],[offset,0],[0,-offset],[0,offset]]) {
    const entry = { x:hall.x+x!, y:hall.y+y! };
    if (!workerFits(game, entry) || !segmentWalkable(game.map, mine, entry)) continue;
    const steps = Math.ceil(Math.hypot(entry.x-mine.x, entry.y-mine.y)/8);
    const route = Array.from({length:steps+1}, (_,i) => ({ x:mine.x+(entry.x-mine.x)*i/steps, y:mine.y+(entry.y-mine.y)*i/steps }));
    // After construction the same lane must remain outside the hall's body.
    if (route.every(at => workerFits(game, at) && Math.hypot(Math.max(0,Math.abs(at.x-hall.x)-half),Math.max(0,Math.abs(at.y-hall.y)-half)) >= WORKER_RADIUS)) return entry;
  }
  return undefined;
}

function hallSite(game: Game, mine: ResourceNode) {
  const cell = game.map.terrain!.cell, half = footprintHalf(HALL_RADIUS, cell), ring = half+cell/2;
  const candidates = new Map<string,Point>();
  for (let y=mine.y-GOLD_MINE_RULES.baseRange; y<=mine.y+GOLD_MINE_RULES.baseRange; y+=cell) {
    for (let x=mine.x-GOLD_MINE_RULES.baseRange; x<=mine.x+GOLD_MINE_RULES.baseRange; x+=cell) {
      const at = snapToFootprint(game.map,HALL_RADIUS,{x,y}), distance = Math.hypot(at.x-mine.x,at.y-mine.y);
      if (distance >= GOLD_MINE_RULES.townHallDistance && distance <= GOLD_MINE_RULES.baseRange) candidates.set(`${at.x},${at.y}`,at);
    }
  }
  for (const at of candidates.values()) {
    if (terrainBlocksPlacement(game.map,'townHall',at) || buildingPlacementBlocker(game,'townHall',at)) continue;
    // A full flat cell outside all four walls makes this a usable base pad,
    // rather than a single foundation whose outer edge touches shallow water.
    if (!isFootprintBuildable(game.map,at.x,at.y,HALL_RADIUS+cell)) continue;
    let perimeter = true;
    for (let y=-ring; y<=ring; y+=cell) for (let x=-ring; x<=ring; x+=cell) {
      if (Math.abs(x) === ring || Math.abs(y) === ring) perimeter &&= workerFits(game,{x:at.x+x,y:at.y+y});
    }
    if (!perimeter) continue;
    const entry = mineEntrance(game,mine,at);
    if (entry) return { at, entry };
  }
  return undefined;
}

describe('every pool gold mine supports an accessible hauling base', () => {
  it.each(MAP_POOL.map(map => [map.id] as const))('%s keeps complete foundations, mineral clearances and worker access', id => {
    const game = poolGame(id);
    expect(game.map.width).toBe(ECONOMY[id][0]);
    expect(game.map.height).toBe(ECONOMY[id][0]);
    expect(game.resources.filter(mine => mine.kind === 'goldMine')).toHaveLength(ECONOMY[id][1]);
    for (const mine of game.resources.filter(mine => mine.kind === 'goldMine')) {
      const existing = game.buildings.find(hall => hall.kind === 'townHall' && Math.hypot(hall.x-mine.x,hall.y-mine.y) <= GOLD_MINE_RULES.baseRange);
      if (existing) {
        expect(terrainBlocksPlacement(game.map,'townHall',existing), `${id}: ${mine.id} main foundation`).toBe(false);
        expect(buildingPlacementBlocker({...game,buildings:game.buildings.filter(hall => hall !== existing)},'townHall',existing), `${id}: ${mine.id} main clearance`).toBeUndefined();
        expect(mineEntrance(game,mine,existing), `${id}: ${mine.id} main hauling entrance`).toBeDefined();
      } else {
        expect(hallSite(game,mine), `${id}: ${mine.id} needs a full flat base pad at 280–320, a walkable perimeter and a worker-sized mining lane`).toBeDefined();
      }
    }
  });

  it.each([['sapphireArchipelago','gold-satellite-0'],['veiledHill','gold-gen-3']] as const)('%s lets a real worker construct a mineral base after its camp is cleared', (id,mineId) => {
    const game = poolGame(id), mine = game.resources.find(mine => mine.id === mineId)!;
    const site = hallSite(game,mine)!;
    expect(site).toBeDefined();
    // Defeating the camp is the ordinary prerequisite; keep all actual terrain,
    // resources, standing buildings and rock/gate obstacles from createGame.
    game.units = [createUnit('expansion-builder','player','worker',mine.x,mine.y)];
    game.players.player!.gold = BUILDING_DEFS.townHall.cost;
    game.scriptedVictory = true;
    issueCommand(game,{type:'build',unitId:'expansion-builder',buildingKind:'townHall',x:site.at.x,y:site.at.y});
    let hall = game.buildings.find(hall => hall.x === site.at.x && hall.y === site.at.y);
    for (let tick=0; tick<seconds(40) && !hall?.complete; tick++) {
      stepGame(game);
      hall = game.buildings.find(hall => hall.kind === 'townHall' && hall.x === site.at.x && hall.y === site.at.y);
    }
    expect(hall?.complete).toBe(true);
    const worker = game.units[0]!, half = footprintHalf(HALL_RADIUS,game.map.terrain!.cell);
    const gap = Math.hypot(Math.max(0,Math.abs(worker.x-site.at.x)-half),Math.max(0,Math.abs(worker.y-site.at.y)-half));
    expect(gap).toBeGreaterThanOrEqual(WORKER_RADIUS-1);
    expect(gap).toBeLessThanOrEqual(BUILDING_WORK_REACH);
    expect(game.players.player!.gold).toBe(0);
  });
});
