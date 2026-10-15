import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuilding, createUnit } from './map';
import { SHIP_KINDS } from './ship-geometry';
import { shipLaunchPose } from './ship-launch';
import * as navigation from './ship-navigation';
import * as terrain from './terrain';
import type { GameMap, Unit } from './types';

function harbor(cells:(x:number,y:number)=>string=x=>x<10?'.':'~',dockX=304) {
  const map:GameMap={id:'bareDuel',name:'Launch test',width:1600,height:1280,landmarks:[],
    terrain:{cell:32,cols:50,rows:40,cells:Array.from({length:2000},(_,i)=>cells(i%50,Math.floor(i/50))).join('')}};
  const dock=createBuilding('dock','player','shipyard',dockX,624,true);
  dock.rallyX=1400;dock.rallyY=624;
  return {map,dock,units:[] as Unit[],buildings:[dock]};
}

afterEach(()=>vi.restoreAllMocks());

describe('launch candidates are checked only when needed',()=>{
  it.each(SHIP_KINDS)('selects the same cold and warm %s berth with few exact probes',kind=>{
    const world=harbor(),ship=createUnit('probe','player',kind,world.dock.x,world.dock.y);
    const checks=vi.spyOn(navigation,'hullFits');
    const first=shipLaunchPose(world,world.dock,ship);
    expect(first).toBeDefined();
    const count=checks.mock.calls.length;
    expect(count).toBeLessThan(16*4*5*3/10);
    expect(shipLaunchPose(world,world.dock,ship)).toEqual(first);
    expect(checks.mock.calls.length).toBe(count);
    const cold=JSON.parse(JSON.stringify(world));
    expect(shipLaunchPose(cold,cold.dock,JSON.parse(JSON.stringify(ship)))).toEqual(first);
  });

  it('waits when all reachable berths are occupied even if another basin is clear',()=>{
    const world=harbor(x=>x===20?'.':',',656);
    const ship=createUnit('probe','player','transport',656,624);
    expect(shipLaunchPose(world,world.dock,ship)!.x).toBeGreaterThan(656);
    const blocker=createUnit('blocker','player','rockGolem',960,624);
    blocker.radius=blocker.bodyRadius=350;
    world.units.push(blocker);
    expect(shipLaunchPose(world,world.dock,ship)).toBeUndefined();
    world.dock.rallyX=100;
    expect(shipLaunchPose(world,world.dock,ship)!.x).toBeLessThan(656);
  });

  it('does not start routing for an impossible static harbor before an in-place coast edit',()=>{
    const world=harbor(x=>x===10?'~':'.'),ship=createUnit('probe','player','carrier',304,624);
    const routed=vi.spyOn(terrain,'steerPoint'),walkable=vi.spyOn(terrain,'walkableGoal');
    expect(shipLaunchPose(world,world.dock,ship)).toBeUndefined();
    expect(routed).not.toHaveBeenCalled();expect(walkable).not.toHaveBeenCalled();
    world.map.terrain!.cells='~'.repeat(2000);
    const result=shipLaunchPose(world,world.dock,ship);
    expect(result).toBeDefined();
    const cold=JSON.parse(JSON.stringify(world));
    expect(shipLaunchPose(cold,cold.dock,JSON.parse(JSON.stringify(ship)))).toEqual(result);
  });
});
