import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { createGame } from './sim';
import { advanceShipRouteSearch, hullPassageClear, planShipRoute, type ShipRouteSearchState, type ShipPose } from './ship-navigation';
import type { GameMap } from './types';
function scene() {
  const cell=32,cols=80,rows=64;
  const map:GameMap={...createGame('bareDuel').map,width:cols*cell,height:rows*cell,
    wind:{direction:Math.PI/2,speed:80},terrain:{cell,cols,rows,cells:Array.from({length:cols*rows},(_,i)=>
      i%cols>=32 && i%cols<45 && Math.floor(i/cols)>=20 && Math.floor(i/cols)<45 ? '.' : '~').join('')}};
  const ship=createUnit('route','player','transport',16.5*cell,32.5*cell);
  ship.sailing={heading:0,speed:0,load:0,balance:0};
  return {map,ship,goal:{x:62.5*cell,y:32.5*cell}};
}
describe('continued heading-lattice searches',()=>{
  it.each([12,128,1024,Infinity])('retains exact synchronous route with budget %s across JSON and interleaved searches',budget=>{
    const {map,ship,goal}=scene();
    const traffic=(a:ShipPose,b:ShipPose)=>Math.max(a.y,b.y)<=44*32;
    const expected=planShipRoute(map,ship,goal,traffic,budget,true);
    let state:ShipRouteSearchState={phase:'prepare'},result:ReturnType<typeof planShipRoute>|undefined,steps=0;
    while(!result && steps++<300){
      result=advanceShipRouteSearch(map,ship,goal,traffic,budget,true,state);
      state=JSON.parse(JSON.stringify(state));
      planShipRoute(map,ship,{x:20.5*32,y:12.5*32},undefined,4,true);
    }
    expect(steps).toBeGreaterThan(2);expect(result).toEqual(expected);
    let previous={x:ship.x,y:ship.y,heading:ship.sailing.heading};
    for(const point of result!.points){expect(hullPassageClear(map,ship,previous,point)).toBe(true);previous=point;}
    if(Number.isFinite(budget))expect(state.visited).toBeLessThanOrEqual(budget+1);
  });
  it('retains temporary obstruction semantics through a saved terrain-only fallback',()=>{
    const {map,ship,goal}=scene();
    const traffic=(a:ShipPose,b:ShipPose)=>Math.min(a.y,b.y)>=20*32 && Math.max(a.y,b.y)<=45*32;
    const expected=planShipRoute(map,ship,goal,traffic,Infinity,true);
    let state:ShipRouteSearchState={phase:'prepare'},result:ReturnType<typeof planShipRoute>|undefined,fallback=false;
    for(let steps=0;!result && steps<500;steps++){
      result=advanceShipRouteSearch(map,ship,goal,traffic,Infinity,true,state);
      fallback||=state.phase==='fallback';
      state=JSON.parse(JSON.stringify(state));
      planShipRoute(map,ship,{x:600,y:300},undefined,8,true);
    }
    expect(fallback).toBe(true);expect(expected.partial).toBe(true);expect(result).toEqual(expected);
  });

});
