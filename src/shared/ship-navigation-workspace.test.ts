import { describe, expect, it } from 'vitest';
import { createMap, createUnit } from './map';
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

function reentrantCoast() {
  const cols=48,rows=40,cell=32;
  const map:GameMap={...createMap('bareDuel'),width:cols*cell,height:rows*cell,
    wind:{direction:Math.PI/2,speed:80},
    terrain:{cols,rows,cell,cells:Array.from({length:cols*rows},(_,i)=>
      i%cols>=22 && i%cols<=25 && Math.floor(i/cols)>=11 && Math.floor(i/cols)<=28 ? '.' : '~').join('')}};
  const outer=createUnit('outer','player','cutter',8.5*cell,20.5*cell);
  const inner=createUnit('inner','player','cutter',8.5*cell,15.5*cell);
  for(const ship of [outer,inner])ship.sailing={heading:0,speed:0,load:0,balance:0};
  return {map,outer,inner,goal:{x:39.5*cell,y:20.5*cell}};
}

describe('numeric route search scratch',()=>{
  it.each([180,250,310])('isolates a nested custom route query at traffic check %i',trigger=>{
    const {map,outer,inner,goal}=reentrantCoast(),before=JSON.stringify({map,outer,inner});
    const expected=planShipRoute(map,outer,goal,()=>true,12,true);
    const expectedInner=planShipRoute(map,inner,goal,undefined,2,true);
    let calls=0,nested:ReturnType<typeof planShipRoute>|undefined;
    const actual=planShipRoute(map,outer,goal,()=>{
      if(++calls===trigger)nested=planShipRoute(map,inner,goal,undefined,2,true);
      return true;
    },12,true);
    expect(nested).toEqual(expectedInner);
    expect(actual).toEqual(expected);
    expect(planShipRoute(map,outer,goal,()=>true,12,true)).toEqual(expected);
    expect(JSON.stringify({map,outer,inner})).toBe(before);
  });

  it.each([180,250,310])('recovers from callback exceptions around a nested search at check %i',trigger=>{
    const {map,outer,inner,goal}=reentrantCoast(),before=JSON.stringify({map,outer,inner});
    const expected=planShipRoute(map,outer,goal,()=>true,12,true),failure=new Error('traffic query failed');
    let calls=0,innerCalls=0;
    const caught=planShipRoute(map,outer,goal,()=>{
      if(++calls===trigger)expect(()=>planShipRoute(map,inner,goal,()=>{
        if(++innerCalls===180)throw failure;
        return true;
      },2,true)).toThrow(failure);
      return true;
    },12,true);
    expect(innerCalls).toBe(180);expect(caught).toEqual(expected);
    calls=0;
    expect(()=>planShipRoute(map,outer,goal,()=>{
      if(++calls===trigger){planShipRoute(map,inner,goal,undefined,2,true);throw failure;}
      return true;
    },12,true)).toThrow(failure);
    expect(planShipRoute(map,outer,goal,()=>true,12,true)).toEqual(expected);
    expect(planShipRoute(map,inner,goal,undefined,2,true)).toEqual(planShipRoute(map,inner,goal,()=>true,2,true));
    expect(JSON.stringify({map,outer,inner})).toBe(before);
  });

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
