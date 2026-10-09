import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { shipProfile } from './ship-geometry';
import { shipMotionLimits, shipPartMax } from './ship-handling';
import { shipTraffic } from './ship-avoidance';
import { headingDifference, hullFits, hullPassageClear, planBeatDeparture, planShipRoute, planVoyageRoute, roundVoyageCorner, shipPoseAt, shipTackRoute, voyageTurnRadius, type ShipPose } from './ship-navigation';
import { coursePerformance } from './ship-wind';
import { createGame } from './sim';
import type { GameMap, Unit, UnitKind } from './types';

function water(blocked:(col:number,row:number)=>boolean=()=>false):GameMap {
  let cells='';
  for(let y=0;y<100;y++)for(let x=0;x<100;x++)cells+=blocked(x,y)?'.':'~';
  return {...createGame('bareDuel').map,width:10000,height:10000,wind:{direction:Math.PI,speed:80},terrain:{cell:100,cols:100,rows:100,cells}};
}
function vessel(kind:UnitKind='transport',heading=0):Unit {
  const unit=createUnit('boat','player',kind,4000,5000);
  unit.sailing={heading,speed:0,load:0,balance:0};
  return unit;
}
const pose=(unit:Unit):ShipPose=>({x:unit.x,y:unit.y,heading:unit.sailing!.heading});
function expectSwept(map:GameMap,ship:Unit,points:readonly ShipPose[]) {
  let previous=pose(ship);
  for(const point of points){
    expect(hullFits(map,ship,point)).toBe(true);
    expect(hullPassageClear(map,ship,previous,point)).toBe(true);
    previous=point;
  }
}
function expectContinuous(ship:Unit,points:readonly ShipPose[]) {
  let previous=pose(ship);
  const limits=shipMotionLimits(ship);
  for(const point of points){
    const gap=Math.hypot(point.x-previous.x,point.y-previous.y),yaw=headingDifference(previous.heading,point.heading);
    expect(gap).toBeGreaterThan(1e-6);
    expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.PI/36+1e-7);
    expect(point.pivot).toBeUndefined();expect(point.exact).toBeUndefined();
    if(point.curvature){
      expect(gap).toBeCloseTo(2*Math.sin(Math.abs(yaw)/2)/Math.abs(point.curvature),4);
      expect(Math.sign(yaw)).toBe(Math.sign(point.curvature));
      expect(point.speedLimit!*Math.abs(point.curvature)).toBeLessThan(limits.turnRate);
      const mid=shipPoseAt(previous,point,.5);
      expect(Math.hypot(mid.x-previous.x,mid.y-previous.y)).toBeCloseTo(2*Math.sin(Math.abs(yaw)/4)/Math.abs(point.curvature),4);
    }else{
      expect(Math.abs(yaw)).toBeLessThan(1e-7);
      expect(Math.abs(headingDifference(point.heading,Math.atan2(point.y-previous.y,point.x-previous.x)))).toBeLessThan(1e-7);
    }
    previous=point;
  }
}

describe('forward voyage planning',()=>{
  it.each(['cutter','transport','warship','carrier'] as const)('%s makes one continuous ahead turn to a point astern',kind=>{
    const map=water(),ship=vessel(kind),goal={x:2500,y:5000};
    const route=planVoyageRoute(map,ship,goal);
    expect(route.partial).toBe(false);
    expect(route.points.at(-1)).toMatchObject(goal);
    expect(route.points.length).toBeGreaterThan(3);
    let previous=pose(ship),turnSide=0;
    for(const point of route.points){
      const dx=point.x-previous.x,dy=point.y-previous.y,yaw=headingDifference(previous.heading,point.heading);
      expect(Math.hypot(dx,dy)).toBeGreaterThan(1e-6);
      expect(dx*Math.cos(previous.heading+yaw/2)+dy*Math.sin(previous.heading+yaw/2)).toBeGreaterThan(0);
      expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.PI/18+1e-7);
      if(Math.abs(yaw)>1e-7){turnSide ||= Math.sign(yaw);expect(Math.sign(yaw)).toBe(turnSide);}
      expect(point.pivot).toBeUndefined();previous=point;
    }
    expectSwept(map,ship,route.points);
  });

  it('uses a single ahead leg and retains precise short astern maneuvers',()=>{
    const map=water(),ship=vessel();
    expect(planVoyageRoute(map,ship,{x:5500,y:5000}).points).toEqual([{x:5500,y:5000,heading:0}]);
    const behind={x:3960,y:5000};
    expect(planVoyageRoute(map,ship,behind)).toEqual(planShipRoute(map,ship,behind));
    const berth={x:4300,y:5200,heading:Math.PI/2};
    expect(planVoyageRoute(map,ship,berth)).toEqual(planShipRoute(map,ship,berth));
  });

  it('backs less than one hull length into an aligned berth without two U-turns',()=>{
    const map=water(),ship=vessel('warship'),goal={x:ship.x-130,y:ship.y+39.625,heading:0};
    const route=planShipRoute(map,ship,goal);
    expect(route.points.at(-1)).toMatchObject(goal);
    const heading=route.points[0]!.heading;
    expect(Math.abs(headingDifference(0,heading))).toBeLessThan(Math.PI/4);
    expect((goal.x-ship.x)*Math.cos(heading)+(goal.y-ship.y)*Math.sin(heading)).toBeLessThan(0);
    expectSwept(map,ship,route.points);
    const cruise=planVoyageRoute(map,ship,{x:goal.x,y:goal.y});
    const first=cruise.points[0]!;
    expect((first.x-ship.x)*Math.cos(first.heading)+(first.y-ship.y)*Math.sin(first.heading)).toBeGreaterThan(0);
  });

  it('checks moving-hull exclusion for every curved segment',()=>{
    const map=water(),ship=vessel(),goal={x:2500,y:5000};
    // Leave tracking room beside the initial hull, but obstruct the whole
    // starboard turning circle so the port curve must be selected.
    const margin=shipProfile(ship)!.length*.15;
    const route=planVoyageRoute(map,ship,goal,(a,b)=>a.y<=ship.y+margin && b.y<=ship.y+margin);
    expect(route.points.length).toBeGreaterThan(3);
    expect(route.points.every(point=>point.y<=ship.y+1e-7)).toBe(true);
    expect(route.points.at(-1)).toMatchObject(goal);
    expectSwept(map,ship,route.points);
  });

  it('marks a zero-margin reference for exact control instead of smoothing through it',()=>{
    const map=water(),ship=vessel(),goal={x:2500,y:5000};
    const route=planVoyageRoute(map,ship,goal,(a,b)=>a.y<=ship.y+1e-7 && b.y<=ship.y+1e-7);
    expect(route.points.at(-1)).toMatchObject(goal);
    expect(route.points.every(point=>point.exact)).toBe(true);
    expectSwept(map,ship,route.points);
  });

  it('retains swept coastal references instead of cutting an island corner',()=>{
    const map=water((x,y)=>x>=46 && x<=50 && y>=45 && y<=55),ship=vessel(),goal={x:5700,y:5000};
    const route=planVoyageRoute(map,ship,goal);
    expect(route.points.at(-1)).toMatchObject(goal);
    expect(route.points.some(point=>point.y<4500 || point.y>5600)).toBe(true);
    expectSwept(map,ship,route.points);
  });

  it('keeps damaged-rudder radius finite and never emits invalid coordinates',()=>{
    const map=water(),ship=vessel();ship.shipParts={...shipPartMax(ship),rudder:0};
    expect(Number.isFinite(voyageTurnRadius(ship))).toBe(true);
    const route=planVoyageRoute(map,ship,{x:4000,y:6000},()=>true,16);
    expect(route.points.every(point=>Number.isFinite(point.x+point.y+point.heading))).toBe(true);
  });

  it('does not call a traffic-displaced destination the final arrival',()=>{
    const map=water(),ship=vessel(),goal={x:5700,y:5000};
    const route=planShipRoute(map,ship,goal,(a,b)=>Math.hypot(a.x-goal.x,a.y-goal.y)>250 && Math.hypot(b.x-goal.x,b.y-goal.y)>250);
    expect(route.points.length).toBeGreaterThan(0);
    expect(route.points.at(-1)).not.toMatchObject(goal);
    expect(route.partial).toBe(true);
    expect(planShipRoute(map,ship,goal).partial).toBe(false);
  });

  it('waits at a traffic barrier but still completes a terrain-limited destination',()=>{
    const map=water(),ship=vessel(),goal={x:5700,y:5000};
    const route=planShipRoute(map,ship,goal,(a,b)=>(a.x<4500 && b.x<4500)||(a.x>4700 && b.x>4700));
    expect(route.points.at(-1)!.x).toBeLessThan(4500);
    expect(route.partial).toBe(true);
    const land=water(x=>x>=45 && x<=47),limited=planShipRoute(land,ship,goal);
    expect(limited.points.at(-1)!.x).toBeLessThan(4500);
    expect(limited.partial).toBe(false);
  });

  it('backs away from a blocked bow to regain a lattice entrance for a coastal detour',()=>{
    const map=water(),cols=36,rows=20;
    map.width=cols*32;map.height=rows*32;
    map.terrain={cell:32,cols,rows,cells:Array.from({length:rows},(_,row)=>Array.from({length:cols},(_,col)=>
      col<=8 || col>=20 && col<=33 && row>=5 && row<=14 ? '.' : col===9 || col>=19 && col<=34 && row>=4 && row<=15 ? ',' : '~').join('')).join('')};
    const ship=createUnit('ferry','player','transport',556.791341286353,432.5612261193186),other=createUnit('obstruction','player','cutter',540.757264704748,308.3745018398256);
    ship.sailing={heading:-1.796832220795723,speed:0,load:0,balance:0};
    other.sailing={heading:9.276240728706828,speed:0,load:0,balance:0};
    const route=planShipRoute(map,ship,{x:624,y:304},shipTraffic(ship,[ship,other]),1024);
    expect(route.partial).toBe(true);expect(route.points.length).toBeGreaterThan(0);
    const first=route.points[0]!;
    expect((first.x-ship.x)*Math.cos(ship.sailing.heading)+(first.y-ship.y)*Math.sin(ship.sailing.heading)).toBeLessThan(0);
    expectSwept(map,ship,route.points);
    expect(shipTraffic(ship,[ship,other])(pose(ship),first)).toBe(true);
  });
});

describe('layline passage planning',()=>{
  it('establishes a useful moving interception leg even when a complete tack cannot fit before the near intercept',()=>{
    const map=water(),ship=vessel('warship'),bearing=52*Math.PI/180;
    const goal={x:ship.x+150*Math.cos(bearing),y:ship.y+150*Math.sin(bearing),heading:bearing};
    expect(shipTackRoute(map,ship,goal,()=>true)).toBeUndefined();
    const route=planBeatDeparture(map,ship,goal,()=>true)!;
    expect(route.at(-1)).not.toMatchObject({x:goal.x,y:goal.y});
    const leg=route.at(-1)!,previous=route.at(-2) ?? pose(ship);
    expect(Math.hypot(leg.x-previous.x,leg.y-previous.y)).toBeGreaterThanOrEqual(shipProfile(ship)!.length*2-1e-6);
    const drive=coursePerformance(ship,map,leg.heading,{assumeTrimmed:true}).targetSpeed;
    expect(drive*Math.cos(headingDifference(leg.heading,bearing))).toBeGreaterThan(coursePerformance(ship,map,bearing,{assumeTrimmed:true}).targetSpeed*1.5);
    expectContinuous(ship,route);expectSwept(map,ship,route);
    expect(planBeatDeparture(map,ship,goal,()=>false)).toBeUndefined();
  });
  it.each(['cutter','transport','warship','carrier'] as const)('%s describes the initial turn and the wind crossing as moving arcs',kind=>{
    const map=water(),ship=vessel(kind),goal={x:5700,y:5000,heading:0};
    const route=shipTackRoute(map,ship,goal,()=>true)!;
    expect(route[0]!.curvature).not.toBe(0);
    expect(route.at(-1)).toMatchObject({x:5700,y:5000,curvature:0});
    expect(route.filter(point=>point.curvature===0)).toHaveLength(2);
    expectContinuous(ship,route);expectSwept(map,ship,route);
  });

  it('plans the speed and tangent entry before a queued right-angle corner',()=>{
    const map=water(),ship=vessel('warship'),corner={x:5700,y:5000},next={x:5700,y:6800};
    ship.sailing!.speed=ship.speed;
    const route=roundVoyageCorner(map,ship,pose(ship),corner,next)!;
    expect(route[0]!.x).toBeLessThan(corner.x-shipProfile(ship)!.length*.6);
    expect(route[0]!.speedLimit).toBeLessThan(ship.speed);
    expect(route.at(-1)).toMatchObject(next);
    expectContinuous(ship,route);expectSwept(map,ship,route);
    // A reference with no turn corridor cannot silently cut the corner.
    expect(roundVoyageCorner(map,ship,pose(ship),corner,next,(a,b)=>a.y<=5001 && b.y<=5001)).toBeUndefined();
  });
  it.each(['cutter','transport','warship'] as const)('%s uses two long legs to the whole destination and holds its initial tack',kind=>{
    const map=water(),ship=vessel(kind),goal={x:5700,y:5000,heading:0};
    const beat=coursePerformance(ship,map,0,{assumeTrimmed:true}).beatAngle;
    for(const side of [-1,1]){
      ship.sailing!.heading=side*beat;
      const route=shipTackRoute(map,ship,goal,()=>true)!;
      expect(route.filter(point=>point.curvature===0)).toHaveLength(2);
      expectContinuous(ship,route);
      expect(route[0]!.y*side).toBeGreaterThan(ship.y*side);
      expect(Math.hypot(route[0]!.x-ship.x,route[0]!.y-ship.y)).toBeGreaterThan(shipProfile(ship)!.length*3);
      expect(route.at(-1)).toMatchObject({...goal,heading:expect.any(Number),tack:true});
      expect(Math.abs(headingDifference(route.at(-1)!.heading,0))).toBeCloseTo(beat);
      for(const point of route.filter(point=>!point.curvature))expect(coursePerformance(ship,map,point.heading,{assumeTrimmed:true}).noGo).toBe(false);
      expectSwept(map,ship,route);
    }
  });

  it('chooses the opposite long tack when the preferred layline crosses land',()=>{
    const map=water((x,y)=>x>=43 && x<=49 && y>=56 && y<=72),ship=vessel('warship');
    ship.sailing!.heading=coursePerformance(ship,map,0,{assumeTrimmed:true}).beatAngle;
    const route=shipTackRoute(map,ship,{x:5700,y:5000,heading:0},()=>true)!;
    expect(route.find(point=>point.curvature===0)!.heading).toBeLessThan(0);
    expect(route.at(-1)).toMatchObject({x:5700,y:5000});
    expectContinuous(ship,route);
    expectSwept(map,ship,route);
  });

  it('shortens the passage only when the full pair has no sea room',()=>{
    const map=water((_,y)=>y<40 || y>60),ship=vessel('warship');
    ship.sailing!.heading=coursePerformance(ship,map,0,{assumeTrimmed:true}).beatAngle;
    const route=shipTackRoute(map,ship,{x:5700,y:5000,heading:0},()=>true)!;
    expect(route.at(-1)!.x).toBeGreaterThan(ship.x);
    expect(route.at(-1)!.x).toBeLessThan(5700);
    expectContinuous(ship,route);
    expectSwept(map,ship,route);
  });

  it('shortens a committed tack before reversing it on a moving-target update',()=>{
    const map=water((_,y)=>y>60),ship=vessel('warship');
    const beat=coursePerformance(ship,map,0,{assumeTrimmed:true}).beatAngle;
    ship.sailing!.heading=beat;
    const goal={x:5700,y:5000,heading:0};
    const initial=shipTackRoute(map,ship,goal,()=>true)!;
    expect(initial.find(point=>point.curvature===0)!.heading).toBeLessThan(0);
    expect(initial.at(-1)).toMatchObject({x:5700,y:5000});
    const committed=shipTackRoute(map,ship,goal,()=>true,beat)!;
    expect(committed[0]!.y).toBeGreaterThan(ship.y);
    expect(committed.at(-1)!.x).toBeLessThan(goal.x);
    expectSwept(map,ship,committed);
  });
});
