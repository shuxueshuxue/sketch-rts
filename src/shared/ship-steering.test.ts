import { describe,expect,it } from 'vitest';
import { createGame,issuePlayerCommand,restoreSnapshotIntoGame,snapshotGame,stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { headingDifference,hullFits,planVoyageRoute } from './ship-navigation';
import { SHIP_WEAPONS,bestFiringHeading,shipGunCanAim,shipPartMax } from './ship-equipment';
import { seconds } from './time';
import { followShipRoute } from './ship-guidance';
import { avoidanceCourse } from './ship-avoidance';
import { shipMotionLimits } from './ship-handling';
import { coursePerformance } from './ship-wind';
function scene(){const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;game.map.width=2400;game.map.height=2000;game.map.terrain={cell:40,cols:60,rows:50,cells:'~'.repeat(3000)};return game;}
describe('predictable ship steering',()=>{
  for(const degrees of [-175,-120,-90,-45,45,90,120,175,180])it(`takes the short initial turn and follows a forward curve to a ${degrees} degree destination`,()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',1200,1000),angle=degrees*Math.PI/180;
    const goal={x:1200+450*Math.cos(angle),y:1000+450*Math.sin(angle)};
    // This is a steering regression on a sailable course; upwind voyages
    // deliberately tack and are covered separately in ship-tacking.test.ts.
    game.map.wind={direction:angle,speed:80};
    ship.sailing!.heading=0;
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    const reference=planVoyageRoute(game.map,ship,goal).points;
    let from={x:ship.x,y:ship.y},referenceLength=0;
    for(const point of reference){referenceLength+=Math.hypot(point.x-from.x,point.y-from.y);from=point;}
    let totalYaw=0,astern=0,travel=0,movingTurns=0;
    for(let i=0;i<seconds(60)&&ship.order.type==='move';i++){
      const before={x:ship.x,y:ship.y,heading:ship.sailing!.heading};stepGame(game);
      const yaw=headingDifference(before.heading,ship.sailing!.heading);totalYaw+=Math.abs(yaw);
      if(i===0)expect(yaw*headingDifference(0,angle)).toBeGreaterThan(0);
      const distance=Math.hypot(ship.x-before.x,ship.y-before.y);travel+=distance;
      if(Math.abs(yaw)>1e-5 && distance>.001)movingTurns++;
      if((ship.x-before.x)*Math.cos(ship.sailing!.heading)+(ship.y-before.y)*Math.sin(ship.sailing!.heading)<-1e-7)astern++;
      expect(hullFits(game.map,ship)).toBe(true);
    }
    expect(astern).toBe(0);
    // A forward U-turn needs the ship's cruising radius. Bound excess travel
    // against its swept arc-and-tangent reference, and independently prohibit
    // a full extra turn or a turn-only controller.
    expect(totalYaw).toBeLessThan(Math.abs(angle)+Math.PI/2);
    expect(travel).toBeLessThan(referenceLength*1.15);expect(movingTurns).toBeGreaterThan(20);
    expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(5);
  });
  it('anticipates a forward route corner without stopping at its zero-distance turn state',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',700,700),goal={x:1250,y:1250};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    ship.sailing!.route={goalX:goal.x,goalY:goal.y,end:goal,startX:ship.x,startY:ship.y,startHeading:0,cruise:true,
      points:[{x:1250,y:700,heading:0},{x:1250,y:700,heading:Math.PI/2},{...goal,heading:Math.PI/2}]};
    let movingTurns=0,anticipated=false;
    for(let i=0;i<seconds(25) && ship.order.type==='move';i++){
      const before={x:ship.x,y:ship.y,heading:ship.sailing!.heading};stepGame(game);
      const yaw=Math.abs(headingDifference(before.heading,ship.sailing!.heading));
      if(yaw>1e-5){expect(Math.hypot(ship.x-before.x,ship.y-before.y)).toBeGreaterThan(.001);movingTurns++;}
      if(ship.x<1240 && ship.y>705)anticipated=true;
      expect(hullFits(game.map,ship)).toBe(true);
    }
    expect(anticipated).toBe(true);expect(movingTurns).toBeGreaterThan(20);
    expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(1);
  });
  it('preserves a short astern maneuver instead of sailing a loop',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',1200,1000),goal={x:1160,y:1000};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    for(let i=0;i<seconds(5) && ship.order.type==='move';i++){
      const before=ship.x;stepGame(game);
      expect(ship.x).toBeLessThanOrEqual(before);expect(ship.y).toBe(1000);expect(ship.sailing!.heading).toBe(0);
    }
    expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(1);
  });
  it('resumes a curved journey deterministically through a save',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',1200,1000);
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:1200,y:1500});
    for(let i=0;i<seconds(2);i++)stepGame(game);
    expect(ship.sailing!.route?.cruise).toBe(true);expect(ship.sailing!.speed).toBeGreaterThan(0);
    const restored=scene();restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    for(let i=0;i<seconds(15);i++){
      stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));
    }
    expect(ship.order.type).toBe('idle');expect(Math.hypot(ship.x-1200,ship.y-1500)).toBeLessThan(1);
  });
  for(const lateral of [0,200])it(`a destroyed rudder preserves straight propulsion without allowing a turn (lateral=${lateral})`,()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',1000,1000);
    ship.shipParts={...shipPartMax(ship),rudder:0};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:1300,y:1000+lateral});
    for(let i=0;i<seconds(3);i++)stepGame(game);
    expect(ship.sailing!.heading).toBe(0);expect(ship.y).toBe(1000);
    if(lateral===0)expect(ship.x).toBeGreaterThan(1100);else expect(ship.x).toBe(1000);
  });
  it('does not let automatic gun orientation override an explicit journey',()=>{
    const game=scene(),ship=game.spawnUnit('player','warship',700,800),enemy=game.spawnUnit('enemy','warship',500,800);
    ship.sailing!.heading=0;enemy.order={type:'attack',targetId:ship.id};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:1500,y:800});
    for(let i=0;i<seconds(4);i++){stepGame(game);expect(Math.abs(headingDifference(0,ship.sailing!.heading))).toBeLessThan(1e-7);}
    expect(ship.x).toBeGreaterThan(800);
  });
  it('chooses the near side and only the rotation needed to enter its firing arc',()=>{
    const game=scene(),ship=game.spawnUnit('player','carrier',1000,1000),target={x:1240,y:1000};
    ship.sailing!.heading=.8;
    for(const [i,mountId] of ['port0','starboard0','starboard1','starboard2'].entries())game.items.push({id:`gun-${i}`,kind:'shipCannon',shipId:ship.id,mountId,durability:SHIP_WEAPONS.shipCannon.hp,x:ship.x,y:ship.y,cooldownRemaining:0});
    const originalItems=[...game.items];
    const near=game.items.find(item=>item.mountId==='port0')!,desired=bestFiringHeading(game,ship,target);
    expect(headingDifference(ship.sailing!.heading,desired)).toBeGreaterThan(0);
    expect(Math.abs(headingDifference(ship.sailing!.heading,desired))).toBeLessThan(.5);
    game.items.reverse();expect(bestFiringHeading(game,ship,target)).toBe(desired);game.items=originalItems;
    const pose={...ship,sailing:{...ship.sailing!,heading:desired}};
    expect(shipGunCanAim(pose,near,target)).toBe(true);
    expect(bestFiringHeading(game,pose,target)).toBe(desired);
  });
  it('brakes at the real hull limit when a crossing vessel requires a passing slowdown',()=>{
    const game=scene(),ship=game.spawnUnit('player','warship',600,800),crossing=game.spawnUnit('enemy','warship',920,1000);
    const quarry=game.spawnUnit('enemy','warship',2100,1500);
    game.map.wind={direction:Math.PI/2,speed:80};
    ship.order={type:'attack',targetId:quarry.id};
    crossing.order={type:'move',x:920,y:200};
    Object.assign(crossing.sailing!,{heading:-Math.PI/2,speed:40,velocityX:0,velocityY:-40});
    const motion=ship.sailing!;
    Object.assign(motion,{heading:0,speed:50,velocityX:50,velocityY:0});
    motion.sail={angle:coursePerformance(ship,game.map,0,{assumeTrimmed:true}).targetSailAngle,set:1,billow:1,mode:'sail'};
    motion.route={goalX:1700,goalY:800,startX:ship.x,startY:ship.y,startHeading:0,end:{x:1700,y:800},
      points:[{x:1700,y:800,heading:0,curvature:0}],intent:'pursuit',targetId:quarry.id,cruise:true};
    const passing=avoidanceCourse(ship,game.units,0,motion.speed),route=motion.route;
    expect(passing.active).toBe(true);expect(passing.speedScale).toBeLessThan(1);
    expect(passing.speedLimit).toBeUndefined();
    // The CPA decision is made by real moving hulls. Its slowdown must use
    // the hull's deceleration, rather than waiting for wind drag to act.
    expect(followShipRoute(ship,game.map,game.units,1)).toBe(true);
    expect(motion.speed).toBeCloseTo(50-shipMotionLimits(ship).acceleration/20,12);
    expect(ship.x).toBeGreaterThan(600);expect(motion.heading).toBeGreaterThan(0);
    expect(motion.route).toBe(route);expect(hullFits(game.map,ship)).toBe(true);
  });
  it('retains entry headway when wind drive falls without a traffic braking order',()=>{
    const game=scene(),ship=game.spawnUnit('player','warship',600,800),motion=ship.sailing!;
    game.map.wind={direction:Math.PI,speed:80};
    ship.order={type:'move',x:1700,y:800};
    Object.assign(motion,{heading:0,speed:50,velocityX:50,velocityY:0});
    motion.route={goalX:1700,goalY:800,startX:ship.x,startY:ship.y,startHeading:0,end:{x:1700,y:800},
      points:[{x:1700,y:800,heading:0,curvature:0}],cruise:true};
    expect(coursePerformance(ship,game.map,0,{assumeTrimmed:true}).noGo).toBe(true);
    expect(followShipRoute(ship,game.map,game.units,1)).toBe(true);
    expect(motion.speed).toBeCloseTo(50-shipMotionLimits(ship).acceleration/20*.2,12);
    expect(ship.x).toBeGreaterThan(602);expect(motion.heading).toBe(0);
  });
  it('keeps its sails driving on a productive passing course while the old reference points into the wind',()=>{
    const game=scene(),ship=game.spawnUnit('player','warship',600,800),crossing=game.spawnUnit('enemy','warship',920,1000);
    const quarry=game.spawnUnit('enemy','warship',2100,1500);
    game.map.wind={direction:Math.PI/2,speed:80};
    ship.order={type:'attack',targetId:quarry.id};crossing.order={type:'move',x:920,y:200};
    Object.assign(crossing.sailing!,{heading:-Math.PI/2,speed:40,velocityX:0,velocityY:-40});
    const motion=ship.sailing!;
    Object.assign(motion,{heading:0,speed:50,velocityX:50,velocityY:0});
    motion.sail={angle:coursePerformance(ship,game.map,0,{assumeTrimmed:true}).targetSailAngle,set:1,billow:1,mode:'sail'};
    motion.route={goalX:600,goalY:100,startX:ship.x,startY:ship.y,startHeading:0,end:{x:600,y:100},
      points:[{x:600,y:100,heading:-Math.PI/2}],intent:'pursuit',targetId:quarry.id,cruise:true,
      avoidHeading:0,avoidBaseHeading:0,avoidTargetId:crossing.id,avoidTicks:2420,avoidSide:1};
    expect(coursePerformance(ship,game.map,-Math.PI/2,{assumeTrimmed:true}).noGo).toBe(true);
    expect(coursePerformance(ship,game.map,0,{assumeTrimmed:true}).targetSpeed).toBeGreaterThan(40);
    expect(followShipRoute(ship,game.map,game.units,1)).toBe(true);
    expect(motion.sail.mode).toBe('sail');expect(motion.sail.set).toBe(1);
    expect(motion.route.avoidTargetId).toBe(crossing.id);expect(ship.x).toBeGreaterThan(600);
    expect(hullFits(game.map,ship)).toBe(true);
  });
  it('restores a powered stationary passing decision through JSON without losing its real motion',()=>{
    const game=scene(),ship=game.spawnUnit('player','warship',1000,1400),parked=game.spawnUnit('enemy','transport',1320,930),heading=-Math.PI/3;
    game.map.wind={direction:Math.PI,speed:80};
    ship.order={type:'move',x:2000,y:200};parked.order={type:'idle'};
    Object.assign(ship.sailing!,{heading,speed:40,velocityX:40*Math.cos(heading),velocityY:40*Math.sin(heading)});
    Object.assign(parked.sailing!,{heading,speed:0,velocityX:0,velocityY:0});
    ship.sailing!.route={goalX:2000,goalY:200,startX:ship.x,startY:ship.y,startHeading:heading,windKey:'-3.141592653589793:80',
      points:[{x:2000,y:200,heading,curvature:0,tack:true}],end:{x:2000,y:200},cruise:true,windTried:true};
    stepGame(game);
    expect(ship.sailing!.route!.avoidTargetId).toBe(parked.id);
    expect(avoidanceCourse(ship,game.units,heading,ship.sailing!.speed,game.map).speedScale).toBe(1);
    const restored=scene();restoreSnapshotIntoGame(restored,JSON.parse(JSON.stringify(snapshotGame(game))),game.nextId);
    const initial={x:ship.x,y:ship.y};
    for(let tick=0;tick<60;tick++){
      stepGame(game);stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));expect(hullFits(game.map,ship)).toBe(true);
    }
    expect(Math.hypot(ship.x-initial.x,ship.y-initial.y)).toBeGreaterThan(10);
  });
});
