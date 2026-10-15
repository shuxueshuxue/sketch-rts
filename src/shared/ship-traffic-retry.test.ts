import { expect, it, vi } from 'vitest';
import { createMap, createUnit } from './map';
import { planShipRoute, planShipTrafficRetry, type ShipPose } from './ship-navigation';
import { shipProfile } from './ship-geometry';
import { cancelShipPlanningJob } from './ship-planning-job';

function scene(){
  const cell=32,cols=48,rows=40;
  const map={...createMap('bareDuel'),width:cell*cols,height:cell*rows,wind:{direction:Math.PI/2,speed:80},
    terrain:{cell,cols,rows,cells:'~'.repeat(cols*rows)}};
  const ship=createUnit('retry','player','cutter',400,600);
  ship.sailing={heading:0,speed:0,load:0,balance:0};
  const goal={x:800,y:600,heading:Math.PI/2};
  const traffic=Object.assign(vi.fn(()=>true),{hasTraffic:false});
  return {map,ship,goal,traffic};
}
function graph(value:unknown,seen=new Map<object,number>()):unknown {
  if(value && typeof value==='object'){
    if(seen.has(value))return {ref:seen.get(value)};
    const id=seen.size;seen.set(value,id);
    return {id,array:Array.isArray(value),entries:Object.entries(value).map(([key,v])=>[key,graph(v,seen)])};
  }
  return value;
}
it('returns pristine values and internal aliases after points/end/exact/pivot edits, including empty and partial results',()=>{
  const cases=[scene(),scene(),scene(),scene()];
  cases[1]!.map.terrain.cells='.'.repeat(48*40);
  cases[2]!.goal={x:400,y:600,heading:0};
  cases[3]!.map.terrain.cells=Array.from({length:48*40},(_,i)=>i%48>=20&&i%48<28&&Math.floor(i/48)>10&&Math.floor(i/48)<30?'.':'~').join('');
  cases[3]!.goal.x=1100;
  const outcomes=[];
  for(const [index,{map,ship,goal,traffic}] of cases.entries()){
    const budget=index===3?0:Infinity;
    const expected=planShipRoute(map,ship,goal,traffic,budget);
    const first=planShipTrafficRetry(map,ship,goal,traffic,budget);
    expect(graph(first)).toEqual(graph(expected));outcomes.push({count:first.points.length,partial:first.partial});
    const end=first.points.at(-1);
    if(end){end.exact=true;end.x=-900;if(end.pivot)end.pivot.x=-999;}
    first.points.shift();first.points.push({x:1,y:2,heading:3,pivot:{x:4,y:5}});first.partial=!first.partial;
    const next=planShipTrafficRetry(map,ship,goal,traffic,budget);
    expect(graph(next)).toEqual(graph(expected));expect(next).not.toBe(first);expect(traffic).not.toHaveBeenCalled();
    expect(graph(planShipTrafficRetry(map,ship,goal,traffic,budget))).toEqual(graph(expected));
  }
  expect(outcomes.some(x=>x.count===0)).toBe(true);
  expect(outcomes.some(x=>x.partial)).toBe(true);
});
it('revalidates in-place input changes, replacement objects, cancellation and cold restored values',()=>{
  let {map,ship,goal,traffic}=scene();
  const mutations=[()=>{ship.x+=1;},()=>{ship.sailing!.heading=-0;},()=>{goal.heading=0;},
    ()=>{map.wind.speed=40;},()=>{map.wind.direction+=.25;},()=>{ship.deckScale=1;},
    ()=>{ship.sailing!.load=20;ship.sailing!.balance=.5;},()=>{ship.speed+=1;},
    ()=>{ship.shipParts={rigging:1,rudder:1,cabin:0};},()=>{map.width-=1;},
    ()=>{ship.fittings=[{id:'fit',x:0,y:0,radius:1,bearing:0,halfArc:1,accepts:[]}];},
    ()=>{ship.fittings![0]!.x+=1;},()=>{shipProfile(ship)!.hull[0]!.x+=1;},
    ()=>{map.terrain.cell+=1;},()=>{map.terrain.cols-=1;map.terrain.rows-=1;},
    ()=>{map.terrain.cells='.'.repeat(48*40);},()=>{goal.x+=3;},
    ()=>{ship.sailing=structuredClone(ship.sailing);},()=>{cancelShipPlanningJob(ship);},
    ()=>{ship=structuredClone(ship);},()=>{map=structuredClone(map);}];
  const clone=vi.spyOn(globalThis,'structuredClone');
  const misses=()=>clone.mock.calls.filter(([value])=>value && typeof value==='object' && 'ship' in value && 'goal' in value).length;
  try{for(const change of mutations){
    planShipTrafficRetry(map,ship,goal,traffic,Infinity);change();
    const before=misses();
    expect(graph(planShipTrafficRetry(map,ship,goal,traffic,Infinity))).toEqual(graph(planShipRoute(map,ship,goal,traffic,Infinity)));
    expect(misses()).toBe(before+1);
  }}finally{clone.mockRestore();}
  expect(traffic).not.toHaveBeenCalled();
});
it('keeps callback searches and nested searches on the original path',()=>{
  const {map,ship,goal}=scene();
  const run=(retry:boolean)=>{
    const events:unknown[]=[];let nested=false;
    const traffic=(from:ShipPose,to:ShipPose)=>{
      events.push([structuredClone(from),structuredClone(to)]);
      if(!nested){nested=true;
        const empty=Object.assign(()=>{throw Error('empty callback called');},{hasTraffic:false});
        expect(planShipTrafficRetry(map,ship,{x:450,y:600},empty,8)).toEqual(planShipRoute(map,ship,{x:450,y:600},empty,8));
      }
      return true;
    };
    const result=(retry?planShipTrafficRetry:planShipRoute)(map,ship,goal,traffic,8);
    return {result,events};
  };
  expect(run(true)).toEqual(run(false));expect(run(true)).toEqual(run(false));
  const fail=()=>{throw Error('traffic failure');};
  expect(()=>planShipTrafficRetry(map,ship,goal,fail,8)).toThrow('traffic failure');
  expect(()=>planShipRoute(map,ship,goal,fail,8)).toThrow('traffic failure');
});
it('distinguishes undefined, signed zero and non-finite raw inputs, and caches negative results',()=>{
  const {map,ship,goal,traffic}=scene();map.terrain.cells='.'.repeat(48*40);
  const clone=vi.spyOn(globalThis,'structuredClone');
  const misses=()=>clone.mock.calls.filter(([value])=>value && typeof value==='object' && 'ship' in value && 'goal' in value).length;
  try{
    for(const speed of [undefined,-0,0,NaN,Infinity,-Infinity]){
      if(speed===undefined)delete (map.wind as {speed?:number}).speed;else map.wind.speed=speed;
      const before=misses(),first=planShipTrafficRetry(map,ship,goal,traffic,Infinity);
      expect(misses()).toBe(before+1);expect(first.points).toEqual([]);
      expect(planShipTrafficRetry(map,ship,goal,traffic,Infinity)).toEqual(first);expect(misses()).toBe(before+1);
    }
    cancelShipPlanningJob(ship);const before=misses();planShipTrafficRetry(map,ship,goal,traffic,Infinity);expect(misses()).toBe(before+1);
  }finally{clone.mockRestore();}
});
