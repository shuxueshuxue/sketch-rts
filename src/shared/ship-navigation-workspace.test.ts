import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { createGame } from './sim';
import { hullPassageClear, planShipRoute, type ShipPose } from './ship-navigation';
import type { GameMap } from './types';

function coast(): GameMap {
  const cols=80,rows=64,cell=32;
  return {...createGame('bareDuel').map,width:cols*cell,height:rows*cell,
    wind:{direction:Math.PI/2,speed:80},
    terrain:{cols,rows,cell,cells:Array.from({length:cols*rows},(_,i)=>
      i%cols>=32 && i%cols<45 && Math.floor(i/cols)>=20 && Math.floor(i/cols)<45 ? '.' : '~').join('')}};
}
function vessel() {
  const ship=createUnit('route','player','transport',16.5*32,32.5*32);
  ship.sailing={heading:0,speed:0,load:0,balance:0};
  return ship;
}
const goal={x:62.5*32,y:32.5*32};

describe('numeric route search scratch',()=>{
  it('returns the same swept coastal route for declared empty traffic and an ordinary custom callback',()=>{
    const map=coast(),ship=vessel();let declaredCalls=0,customCalls=0;
    const declared=Object.assign(()=>{declaredCalls++;return true;},{hasTraffic:false});
    const optimized=planShipRoute(map,ship,goal,declared,Infinity,true);
    const ordinary=planShipRoute(map,ship,goal,(from,to)=>{
      customCalls++;Object.freeze(from);Object.freeze(to);return true;
    },Infinity,true);
    expect(optimized).toEqual(ordinary);expect(optimized.partial).toBe(false);
    expect(declaredCalls).toBe(0);expect(customCalls).toBeGreaterThan(100);
    expect(optimized.points.at(-1)).toMatchObject(goal);
    let previous:ShipPose={x:ship.x,y:ship.y,heading:ship.sailing!.heading};
    for(const point of optimized.points){
      expect(hullPassageClear(map,ship,previous,point)).toBe(true);previous=point;
    }
  });

  it('keeps the custom blocker active across cached searches and interleaved local budgets',()=>{
    const map=coast(),ship=vessel();let blocked=0;
    // The real coast permits either detour. This frozen traffic strip denies
    // the southern passage, so each custom segment check must remain active.
    const traffic=(from:ShipPose,to:ShipPose)=>{
      const clear=Math.max(from.y,to.y)<=44*32;
      if(!clear)blocked++;return clear;
    };
    const route=planShipRoute(map,ship,goal,traffic,Infinity,true);
    expect(route.partial).toBe(false);expect(blocked).toBeGreaterThan(0);
    expect(Math.min(...route.points.map(point=>point.y))).toBeLessThan(20*32);
    expect(Math.max(...route.points.map(point=>point.y))).toBeLessThanOrEqual(44*32);
    for(const budget of [8,64,512])planShipRoute(map,ship,goal,undefined,budget,true);
    expect(planShipRoute(map,ship,goal,traffic,Infinity,true)).toEqual(route);
    const restored=JSON.parse(JSON.stringify(map)) as GameMap;
    expect(planShipRoute(restored,ship,goal,traffic,Infinity,true)).toEqual(route);
  });
});
