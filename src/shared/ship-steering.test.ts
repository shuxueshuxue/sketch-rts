import { describe,expect,it } from 'vitest';
import { createGame,issuePlayerCommand,restoreSnapshotIntoGame,snapshotGame,stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { headingDifference,hullFits,planVoyageRoute } from './ship-navigation';
import { SHIP_WEAPONS,bestFiringHeading,shipGunCanAim,shipPartMax } from './ship-equipment';
import { seconds } from './time';
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
});
