import { describe, expect, it } from 'vitest';
import { sailToward } from './sailing';
import { hullContact, shipProfile } from './ship-geometry';
import { headingDifference, hullFits, hullPassageClear, planVoyageRoute } from './ship-navigation';
import { shipMotionLimits } from './ship-motion';
import { reservationTraffic, shipTraffic } from './ship-avoidance';
import { beginShipPlanningFrame, tryConsumeShipPlan } from './ship-planning-budget';
import { createGame, stepGame } from './sim';
import { SIM_TICKS_PER_SECOND } from './time';

function sea() {
  const game=createGame('bareDuel',{players:['player','enemy'],aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.mercenaryCamps=[];game.scriptedVictory=true;
  game.map={...game.map,width:16384,height:16384,wind:{direction:Math.PI/4,speed:80},
    terrain:{cols:256,rows:256,cell:64,cells:'~'.repeat(256*256)}};
  return game;
}

describe('live exact ship maneuvers',()=>{
  it('starts a deferred replacement curve at the hull that continued its committed exact leg',()=>{
    const game=sea(),ship=game.spawnUnit('player','transport',3000,3000),other=game.spawnUnit('player','warship',10000,10000);
    game.map.wind={direction:Math.PI/2,speed:80};
    const goal={x:7000,y:5000},motion=ship.sailing!;
    ship.order={type:'move',...goal,avoidCombat:true};other.order={type:'move',x:12000,y:10000,avoidCombat:true};
    motion.speed=30;motion.velocityX=30;motion.velocityY=0;
    motion.route={goalX:7000,goalY:3000,points:[{x:3100,y:3000,heading:0,exact:true}],end:{x:3100,y:3000},cruise:false};
    beginShipPlanningFrame(game.units,10);expect(tryConsumeShipPlan(other)).toBe(true);
    sailToward(ship,goal,game.map,game.units);
    expect(JSON.parse(motion.planningJob!).phase).toBe('direct');expect(ship.x).toBeGreaterThan(3000);
    const origin={x:ship.x,y:ship.y,heading:motion.heading};
    const expected=planVoyageRoute(game.map,ship,goal,shipTraffic(ship,game.units));
    expect(expected.points[0]!.curvature).not.toBe(0);
    beginShipPlanningFrame(game.units,11);sailToward(ship,goal,game.map,game.units);
    expect(motion.planningJob).toBeUndefined();expect(motion.route!.points).toEqual(expected.points);
    expect(motion.route).toMatchObject({startX:origin.x,startY:origin.y,startHeading:origin.heading,cruise:true});
    expect(hullFits(game.map,ship)).toBe(true);
    expect(Math.abs(headingDifference(origin.heading,motion.heading))).toBeLessThanOrEqual(shipMotionLimits(ship).turnRate/SIM_TICKS_PER_SECOND+1e-7);
  });

  it('keeps headway when a nearby moving quarry leaves the soft firing station',()=>{
    const game=sea(),ship=game.spawnUnit('player','fireShip',3293.5817479495577,3969.981202034204);
    game.map.wind={direction:Math.PI/2,speed:80};
    const target=game.spawnUnit('enemy','transport',3325.904298598777,4270.377139103723);
    target.sailing!.heading=1.5446165931683131;
    const motion=ship.sailing!,goal={x:3300.0315775772865,y:4029.5462668169334,intent:'pursuit' as const,targetId:target.id,arrivalRadius:8.3424};
    ship.order={type:'attack',targetId:target.id};
    Object.assign(motion,{heading:1.0176460692853344,speed:48.156927992406615,
      velocityX:25.30021983466213,velocityY:40.97546326746851,yawRate:.38494825032773994,
      pursuit:{targetId:target.id,phase:'approach',moving:true}});
    motion.route={goalX:3298.9741032934953,goalY:4027.120534846337,
      points:[{x:3298.9741032934953,y:4027.120534846337,heading:.7414872163864118}],
      end:{x:3298.9741032934953,y:4027.120534846337},cruise:true,fireHeading:1.4305874353265011,
      intent:'pursuit',targetId:target.id,age:113,startX:3130.7087977132055,startY:3873.0197352630034};
    const origin={x:ship.x,y:ship.y,heading:motion.heading};
    beginShipPlanningFrame(game.units,726);sailToward(ship,goal,game.map,game.units);
    expect(motion.route!.cruise).toBe(true);expect(motion.route!.points.some(point=>point.exact||point.pivot)).toBe(false);
    expect(motion.speed).toBeGreaterThan(45);expect(Math.hypot(ship.x-origin.x,ship.y-origin.y)).toBeGreaterThan(2);
    expect(Math.abs(headingDifference(origin.heading,motion.heading))).toBeLessThanOrEqual(shipMotionLimits(ship).turnRate/SIM_TICKS_PER_SECOND+1e-7);
    expect(hullContact(ship,target)?.overlap??0).toBeLessThan(.1);expect(hullFits(game.map,ship)).toBe(true);
  });

  it('reassesses a blocked exact leg in a calm without freezing it for a coastal search',()=>{
    const game=sea(),ship=game.spawnUnit('player','transport',1800,1800),other=game.spawnUnit('player','transport',2500,1800);
    const profile=shipProfile(ship)!;
    other.x=ship.x+Math.max(...profile.hull.map(point=>point.x))-Math.min(...profile.hull.map(point=>point.x))+.001;
    other.order={type:'hold',x:other.x,y:other.y};ship.order={type:'move',x:5000,y:1800,avoidCombat:true};
    const motion=ship.sailing!;
    motion.speed=30;motion.velocityX=30;motion.velocityY=0;
    motion.route={goalX:5000,goalY:1800,points:[{x:5000,y:1800,heading:0,exact:true}],end:{x:5000,y:1800},cruise:false};
    stepGame(game);const previous=motion.route!,waitingX=ship.x,waitingHp=ship.hp,otherWaitingHp=other.hp;
    game.map.wind={direction:Math.PI/2,speed:0,changedAtTick:game.tick};stepGame(game);
    expect(motion.sail?.mode).toBe('calm-assist');expect(motion.planningJob).toBeUndefined();
    expect(motion.route!.points).toEqual(previous.points);expect(motion.route!.windKey).not.toBe(previous.windKey);
    expect(motion.speed).toBe(0);expect(Math.abs(ship.x-waitingX)).toBeLessThan(.001);expect(hullContact(ship,other)?.overlap??0).toBeLessThan(.1);
    expect(ship.hp).toBe(waitingHp);expect(other.hp).toBe(otherWaitingHp);
  });

  it('keeps making progress on a safe astern leg when the periodic recovery interval arrives',()=>{
    const game=sea(),ship=game.spawnUnit('player','warship',3000,3000);
    game.map.wind={direction:Math.PI/2,speed:80};
    ship.order={type:'move',x:7000,y:3000,avoidCombat:true};
    const motion=ship.sailing!;
    motion.heading=Math.PI;motion.speed=12;motion.velocityX=12;motion.velocityY=0;
    const route=motion.route={goalX:7000,goalY:3000,
      points:[{x:3100,y:3000,heading:Math.PI,exact:true}],
      end:{x:3100,y:3000},cruise:false,partial:true,age:SIM_TICKS_PER_SECOND-1,blockedTicks:0};
    for(let tick=0;tick<10;tick++) {
      const before=ship.x;stepGame(game);
      expect(ship.x).toBeGreaterThan(before);
      expect(motion.planningJob).toBeUndefined();expect(motion.route).toBe(route);
      expect(hullFits(game.map,ship)).toBe(true);
    }
  });

  it('does not adopt an astern departure through the follower omitted from its forward strategic corridor',()=>{
    const game=sea();
    const ship=game.spawnUnit('player','warship',6344.372937183484,6169.450673263453);
    const front=game.spawnUnit('player','transport',6243.773372025985,6380.54337413775);
    const rear=game.spawnUnit('player','transport',6376.8634457791695,5943.286835225007);
    const goal={x:6400,y:9980};
    ship.sailing!.heading=1.9945658047100627;ship.order={type:'move',...goal,avoidCombat:true};
    front.sailing!.heading=2.0984085742103264;front.order={type:'move',x:6400,y:10320,avoidCombat:true};
    front.sailing!.route={goalX:6400,goalY:10320,points:[],end:{x:front.x,y:front.y},cruise:false};
    rear.sailing!.heading=1.8880250099012696;rear.order={type:'move',x:6400,y:9640,avoidCombat:true};
    rear.sailing!.route={goalX:6400,goalY:9640,points:[{x:6400,y:9640,heading:Math.PI/2}],end:{x:6400,y:9640},cruise:true};
    const origin={x:ship.x,y:ship.y,heading:ship.sailing!.heading};
    const frozen=planVoyageRoute(game.map,ship,goal,reservationTraffic(ship,[ship,front]),1024);
    const unsafe=frozen.points[0]!;
    expect(unsafe.exact).toBe(true);expect(shipTraffic(ship,game.units)(origin,unsafe)).toBe(false);
    expect(hullContact(ship,rear)?.overlap??0).toBeLessThan(.1);
    for(let tick=0;tick<8;tick++) {
      // Keep the other hulls at their real poses while only this navigator
      // runs. Their move orders still make the rear hull a voyage companion.
      beginShipPlanningFrame(game.units,tick);sailToward(ship,goal,game.map,game.units);
      const first=ship.sailing!.route?.points[0];
      if(first?.exact)expect(shipTraffic(ship,game.units)({x:ship.x,y:ship.y,heading:ship.sailing!.heading},first)).toBe(true);
      expect(hullContact(ship,rear)?.overlap??0).toBeLessThan(.1);
      expect(hullFits(game.map,ship)).toBe(true);
    }
  });

  it('starts a forward recovery when traffic permits an on-the-spot turn but blocks a sailing circle',()=>{
    const game=sea(),ship=game.spawnUnit('player','warship',6279.04768839752,6281.891429365576);
    const goal={x:6400,y:9980},motion=ship.sailing!;
    motion.heading=2.694401147348776;motion.speed=6.326609019810392;
    ship.order={type:'move',...goal,avoidCombat:true};
    motion.route={goalX:goal.x,goalY:goal.y,
      points:[{x:6580.339325233656,y:6137.393190952278,heading:motion.heading,exact:true}],
      end:{x:6580.339325233656,y:6137.393190952278},cruise:false,partial:true,age:SIM_TICKS_PER_SECOND-1};
    const neighbors=[
      game.spawnUnit('player','transport',6069.61641767715,6524.417102825839),
      game.spawnUnit('player','transport',5861.054486516254,6426.945513483746),
      game.spawnUnit('player','warship',6105.118089035841,6334.254912091481),
    ];
    [4.65213185820637,2.3561944901923457,1.5008856407723579].forEach((heading,index)=>{
      const other=neighbors[index]!;other.sailing!.heading=heading;other.order={type:'hold',x:other.x,y:other.y};
    });
    const origin={x:ship.x,y:ship.y,heading:motion.heading};
    const reference=planVoyageRoute(game.map,ship,goal,shipTraffic(ship,game.units),1024);
    expect(reference.partial).toBe(false);expect(reference.points).toHaveLength(1);
    expect(reference.points[0]!.exact).toBe(true);
    const turned={...origin,heading:reference.points[0]!.heading};
    expect(hullPassageClear(game.map,ship,origin,turned)).toBe(true);
    expect(shipTraffic(ship,game.units)(origin,turned)).toBe(true);
    let resumedCruise=false,reverseTravel=0;
    for(let tick=0;tick<12*SIM_TICKS_PER_SECOND;tick++) {
      const before={x:ship.x,y:ship.y,heading:motion.heading};
      stepGame(game);
      const along=(ship.x-before.x)*Math.cos(motion.heading)+(ship.y-before.y)*Math.sin(motion.heading);
      if(along<0)reverseTravel-=along;
      expect(Math.abs(headingDifference(before.heading,motion.heading))).toBeLessThanOrEqual(shipMotionLimits(ship).turnRate/SIM_TICKS_PER_SECOND+1e-7);
      expect(hullFits(game.map,ship)).toBe(true);
      for(const other of neighbors)expect(hullContact(ship,other)?.overlap??0).toBeLessThan(.1);
      resumedCruise ||= motion.route?.cruise===true && motion.route.points.every(point=>!point.exact&&!point.pivot);
    }
    expect(resumedCruise).toBe(true);expect(reverseTravel).toBeLessThan(20);
    expect(ship.y-origin.y).toBeGreaterThan(300);
    expect(motion.route).toMatchObject({goalX:goal.x,goalY:goal.y});
  });
});
