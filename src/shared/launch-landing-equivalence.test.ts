import { describe, expect, it } from 'vitest';
import { unitMover } from './catalog';
import { createBuilding, createUnit } from './map';
import { LANDING_REACH, landingSpot } from './naval';
import { distanceToHull, localToWorld, shipProfile } from './ship-geometry';
import { shipLaunchPose, shipLaunchPrototype } from './ship-launch';
import { createGame } from './sim';
import { isOpenGround, sameGround, setBuildingBodies, walkableGoal } from './terrain';
import { detCos, detSin } from './det-math';
import type { GameMap, Unit, UnitKind } from './types';

// landingSpot as it was before it tested points nearest first: the reference the faster search must match exactly.
function referenceLandingSpot(map: Pick<GameMap, 'terrain' | 'width' | 'height'>, transport: Unit, index: number, count: number, units: readonly Unit[] = [], passenger?: Unit) {
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  const profile=shipProfile(transport);
  const radius=passenger?.radius??12;
  const edge=localToWorld(transport,{x:detCos(angle)*((profile?.length ?? transport.radius*2)/2+radius+2),y:detSin(angle)*((profile?.beam ?? transport.radius*2)/2+radius+2)});
  const shore=transport.order.type==='unload'?walkableGoal(map,transport.order.x,transport.order.y):undefined;
  const preferred=shore??edge;
  const clear=(p:{x:number;y:number})=>p.x>=0&&p.y>=0&&p.x<=map.width&&p.y<=map.height
    && isOpenGround(map,p.x,p.y) && (!shore || sameGround(map,shore,p))
    && distanceToHull(transport,p)>=radius+1 && distanceToHull(transport,p)<=LANDING_REACH
    && !units.some(u=>u!==passenger&&!u.deck&&unitMover(u.kind)==='land'&&Math.hypot(p.x-u.x,p.y-u.y)<radius+u.radius+1);
  const nearest=walkableGoal(map,preferred.x,preferred.y);
  if(clear(nearest))return nearest;
  const span=(profile?.length??transport.radius*2)/2+LANDING_REACH;
  const step=map.terrain?map.terrain.cell/4:Math.max(8,radius);
  let best:{x:number;y:number}|undefined,score=Infinity;
  for(let y=Math.max(step/2,Math.floor((transport.y-span)/step)*step+step/2);y<Math.min(map.height,transport.y+span);y+=step)
    for(let x=Math.max(step/2,Math.floor((transport.x-span)/step)*step+step/2);x<Math.min(map.width,transport.x+span);x+=step) {
      const p={x,y},value=Math.hypot(x-preferred.x,y-preferred.y);
      if(value<score && clear(p)){best=p;score=value;}
    }
  return best;
}

// A coast with a ragged shoreline and a few inland lakes, 32-unit cells.
function coast(): GameMap {
  let cells = '';
  for (let y = 0; y < 40; y++) for (let x = 0; x < 50; x++) {
    const shore = 12 + Math.round(3 * Math.sin(y * 0.7) + 2 * Math.sin(y * 0.23));
    cells += x < shore && !((x - 4) ** 2 + (y - 20) ** 2 < 6) ? '.' : '~';
  }
  return { ...createGame('bareDuel', { aiPlayers: [] }).map, width: 1600, height: 1280, terrain: { cell: 32, cols: 50, rows: 40, cells } };
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

describe('landing and launch searches answer exactly as before', () => {
  it('finds the same landing spot as the full scan for every passenger, crowd and unload order', () => {
    const map = coast(), next = random(20261015);
    const kinds: UnitKind[] = ['transport', 'cutter', 'warship', 'carrier'];
    let landed = 0, refused = 0;
    for (let trial = 0; trial < 300; trial++) {
      const kind = kinds[trial % kinds.length]!;
      const ship = createUnit('ship', 'player', kind, 380 + next() * 260, 120 + next() * 1040);
      ship.sailing = { heading: next() * Math.PI * 2, speed: 0, load: 0, balance: 0 };
      if (next() < 0.4) ship.order = { type: 'unload', unitIds: [ship.id], x: 100 + next() * 300, y: 100 + next() * 1080 } as unknown as Unit["order"];
      const crowd = Array.from({ length: Math.floor(next() * 14) }, (_, index) => createUnit(`crowd-${index}`, next() < 0.5 ? 'player' : 'enemy', next() < 0.5 ? 'footman' : 'worker', 200 + next() * 400, ship.y - 250 + next() * 500));
      const passenger = createUnit('passenger', 'player', next() < 0.5 ? 'footman' : 'archer', ship.x, ship.y);
      const units = [ship, passenger, ...crowd];
      const count = 1 + Math.floor(next() * 6), index = Math.floor(next() * count);
      const expected = referenceLandingSpot(map, ship, index, count, units, passenger);
      expect(landingSpot(map, ship, index, count, units, passenger)).toEqual(expected);
      if (expected) landed++; else refused++;
    }
    // Both the nearest-spot shortcut and the scan, found and refused, are covered.
    expect(landed).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(10);
  });

  it('keeps answering as the full scan while a ship waits at a shore and its ground, orders and crowd change', () => {
    const map = coast(), next = random(20261016);
    const ship = createUnit('ship', 'player', 'transport', 470, 620);
    ship.sailing = { heading: 1.3, speed: 0, load: 0, balance: 0 };
    let landed = 0, refused = 0;
    for (let step = 0; step < 160; step++) {
      // Mostly the same pose tick after tick; now and then it drifts or turns, a building goes up or comes down, a new
      // terrain arrives, or the unload order names another shore.
      if (next() < 0.12) { ship.x += (next() - 0.5) * 50; ship.y += (next() - 0.5) * 50; }
      if (next() < 0.08) ship.sailing.heading += next() - 0.5;
      if (next() < 0.1) setBuildingBodies(map, next() < 0.4 ? [] : [{ x: 260 + next() * 200, y: ship.y - 160 + next() * 320, radius: 30 + next() * 40 }]);
      if (next() < 0.03) map.terrain = { ...map.terrain! };
      if (next() < 0.1) ship.order = next() < 0.3 ? { type: 'idle' }
        : { type: 'unload', unitIds: [ship.id], x: 100 + next() * 300, y: ship.y - 300 + next() * 600 } as unknown as Unit["order"];
      const crowd = Array.from({ length: Math.floor(next() * 12) }, (_, index) => createUnit(`wait-${index}`, 'player',
        next() < 0.5 ? 'footman' : 'worker', ship.x - 220 + next() * 160, ship.y - 150 + next() * 300));
      const count = 1 + Math.floor(next() * 6);
      for (let index = 0; index < count; index++) {
        const passenger = createUnit(`rider-${index}`, 'player', (['footman', 'archer', 'worker', 'knight'] as const)[Math.floor(next() * 4)]!, ship.x, ship.y);
        const units = [ship, passenger, ...crowd];
        const expected = referenceLandingSpot(map, ship, index, count, units, passenger);
        expect(landingSpot(map, ship, index, count, units, passenger)).toEqual(expected);
        if (expected) { landed++; crowd.push({ ...passenger, ...expected }); } else refused++;
      }
    }
    expect(landed).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(10);
  });

  it('keeps choosing the berth a fresh search would choose while the harbor crowd moves', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    game.map = coast(); game.units = []; game.items = []; game.resources = []; game.mercenaryCamps = []; game.shops = [];
    const dock = createBuilding('dock', 'player', 'shipyard', 336, 624, true);
    const wall = createBuilding('wall', 'player', 'farm', 420, 520, true);
    game.buildings = [dock, wall];
    const next = random(7);
    const crowd = Array.from({ length: 10 }, (_, index) => createUnit(`harbor-${index}`, 'enemy', index % 3 ? 'footman' : 'cutter', 380 + next() * 200, 480 + next() * 300));
    for (const unit of crowd) if (shipProfile(unit)) unit.sailing = { heading: next() * Math.PI * 2, speed: 0, load: 0, balance: 0 };
    game.units = crowd;
    const ship = shipLaunchPrototype(dock, 'transport');
    let blocked = 0, open = 0;
    for (let step = 0; step < 240; step++) {
      // A few bodies move each step; now and then one leaves or comes back.
      for (const unit of crowd) if (next() < 0.25) { unit.x += (next() - 0.5) * 60; unit.y += (next() - 0.5) * 60; if (unit.sailing) unit.sailing.heading += (next() - 0.5); }
      if (next() < 0.1) game.units = game.units.length > 4 ? game.units.slice(1) : crowd.slice();
      const remembered = shipLaunchPose(game, dock, ship);
      // A new map object starts every cache over: the search exactly as it ran before verdicts were kept.
      const fresh = shipLaunchPose({ ...game, map: { ...game.map } }, dock, ship);
      expect(remembered).toEqual(fresh);
      if (remembered) open++; else blocked++;
    }
    expect(open).toBeGreaterThan(20);
    expect(blocked).toBeGreaterThan(5);
  });
});
