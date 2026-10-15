import { describe, expect, it } from 'vitest';
import { createMap, createUnit } from './map';
import { advanceShipRouteSearch, createShipPlanningSearch, planShipRoute, type ShipPose, type ShipRouteSearchState } from './ship-navigation';

function scene() {
  const cell=32,cols=80,rows=64;
  const map={...createMap('bareDuel'),width:cols*cell,height:rows*cell,wind:{direction:Math.PI/2,speed:80},
    terrain:{cell,cols,rows,cells:Array.from({length:cols*rows},(_,i)=>
      i%cols>=32 && i%cols<45 && Math.floor(i/cols)>=20 && Math.floor(i/cols)<45?'.':'~').join('')}};
  const ship=createUnit('route','player','transport',16.5*cell,32.5*cell);
  ship.sailing={heading:0,speed:0,load:0,balance:0};
  return {map,ship,goal:{x:62.5*cell,y:32.5*cell}};
}
function recorder(blocked:boolean) {
  const ids=new WeakMap<object,number>();let next=0;
  const identity=(p:object)=>{let id=ids.get(p);if(id===undefined){id=next++;ids.set(p,id);}return id;};
  const events:unknown[]=[];
  return {events,traffic:(from:ShipPose,to:ShipPose)=>{
    events.push([identity(from),identity(to),structuredClone(from),structuredClone(to)]);
    return blocked?Math.min(from.y,to.y)>=20*32 && Math.max(from.y,to.y)<=45*32:Math.max(from.y,to.y)<=44*32;
  }};
}

describe('job-owned planning search',()=>{
  it('preserves every yield, route, callback order and pose identity across interleaved queries',()=>{
    for(const budget of [12,1024,Infinity])for(const blocked of [false,true]){
      const a=scene(),b=scene(),left=recorder(blocked),right=recorder(blocked);
      const state:ShipRouteSearchState={phase:'prepare'};
      const advance=createShipPlanningSearch(b.ship,b.goal,right.traffic,budget,true);
      const other=createShipPlanningSearch(b.ship,{x:600,y:300},()=>true,12,false);
      let result:ReturnType<typeof planShipRoute>|undefined,slices=0;
      while(!result && slices++<500){
        left.events.length=0;right.events.length=0;
        const expected=advanceShipRouteSearch(a.map,a.ship,a.goal,left.traffic,budget,true,state);
        result=advance(b.map);
        expect(result).toEqual(expected);expect(right.events).toEqual(left.events);
        other(b.map);planShipRoute(b.map,b.ship,{x:600,y:300},undefined,8,true);
      }
      expect(result).toBeDefined();expect(slices).toBeGreaterThan(2);
      expect(advance(b.map)).toBe(result);
    }
  });

  it('keeps empty-traffic budgets and isolates a nested public query',()=>{
    for(const empty of [false,true]){
      const a=scene(),b=scene(),state:ShipRouteSearchState={phase:'prepare'};
      const traffic=(s:ReturnType<typeof scene>)=>Object.assign((from:ShipPose,to:ShipPose)=>{
        planShipRoute(s.map,s.ship,{x:600,y:300},undefined,8,false);
        return Math.max(from.y,to.y)<=44*32;
      },empty?{hasTraffic:false}:{});
      const left=traffic(a),right=traffic(b),advance=createShipPlanningSearch(b.ship,b.goal,right,Infinity,true);
      let result:ReturnType<typeof planShipRoute>|undefined,slices=0;
      while(!result && slices++<500){
        const expected=advanceShipRouteSearch(a.map,a.ship,a.goal,left,Infinity,true,state);
        result=advance(b.map);expect(result).toEqual(expected);
      }
      expect(result).toBeDefined();expect(slices).toBeGreaterThan(2);
    }
  });

  it('rechecks berth geometry after terrain contents or map dimensions change between slices',()=>{
    const a=scene(),b=scene(),left=recorder(false),right=recorder(false),state:ShipRouteSearchState={phase:'prepare'};
    const advance=createShipPlanningSearch(b.ship,b.goal,right.traffic,1024,true);
    let result:ReturnType<typeof planShipRoute>|undefined;
    for(let slice=0;slice<80 && !result;slice++){
      if(slice===2)for(const s of [a,b]){
        const index=31*s.map.terrain.cols+61;
        s.map.terrain.cells=s.map.terrain.cells.slice(0,index)+'.'+s.map.terrain.cells.slice(index+1);
      }
      if(slice===3)for(const s of [a,b])s.map.width-=1;
      left.events.length=0;right.events.length=0;
      const expected=advanceShipRouteSearch(a.map,a.ship,a.goal,left.traffic,1024,true,state);
      result=advance(b.map);
      expect(result).toEqual(expected);expect(right.events).toEqual(left.events);
    }
    expect(result).toBeDefined();
  });
});
