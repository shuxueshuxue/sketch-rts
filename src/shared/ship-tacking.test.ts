import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { coursePerformance, getWind } from './ship-wind';
import { headingDifference, hullFits, hullPassageClear, shipTackRoute } from './ship-navigation';
import { shipTraffic } from './ship-avoidance';
import { shipMotionLimits, shipPartMax } from './ship-handling';
import { perTick, seconds } from './time';

function scene(direction=Math.PI,speed=80){
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
  game.map.width=4000;game.map.height=3000;game.map.wind={direction,speed};
  game.map.terrain={cell:40,cols:100,rows:75,cells:'~'.repeat(7500)};
  return game;
}

describe('wind-aware ship voyages',()=>{
  for(const offset of [-.3,0,.3])it(`beats upwind through sustained close-hauled legs (offset=${offset})`,()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',1400,1500);
    const goal={x:ship.x+650*Math.cos(offset),y:ship.y+650*Math.sin(offset)};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    let positive=0,negative=0,furthest=0,changes=0,previousRoute=ship.sailing!.route;
    for(let tick=0;tick<seconds(120)&&ship.order.type==='move';tick++){
      const from={x:ship.x,y:ship.y,heading:ship.sailing!.heading};stepGame(game);
      const distance=Math.hypot(ship.x-from.x,ship.y-from.y),heading=headingDifference(0,ship.sailing!.heading);
      if(distance>.1 && ship.sailing!.sail?.mode==='tacking'){
        if(heading>.5)positive+=distance;if(heading<-.5)negative+=distance;
      }
      furthest=Math.max(furthest,Math.abs((ship.y-1500)*Math.cos(offset)-(ship.x-1400)*Math.sin(offset)));
      if(ship.sailing!.route!==previousRoute){changes++;previousRoute=ship.sailing!.route;}
      expect(hullFits(game.map,ship)).toBe(true);
      expect(hullPassageClear(game.map,ship,from,{x:ship.x,y:ship.y,heading:ship.sailing!.heading})).toBe(true);
    }
    expect(positive).toBeGreaterThan(80);expect(negative).toBeGreaterThan(80);expect(furthest).toBeGreaterThan(80);
    expect(changes).toBeLessThan(12);expect(ship.order.type).toBe('idle');
    expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(1);
  });
  for(const kind of ['transport','bombardShip','fireShip'] as const)for(const side of [-1,1])
    it(`${kind} completes a short ${side*30} degree upwind approach without stalling at the polar boundary`,()=>{
      const game=scene(),ship=game.spawnUnit('player',kind,1400,1500),angle=side*Math.PI/6;
      const goal={x:ship.x+150*Math.cos(angle),y:ship.y+150*Math.sin(angle)};
      issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
      for(let tick=0;tick<seconds(30)&&ship.order.type==='move';tick++)stepGame(game);
      expect(ship.order.type).toBe('idle');expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(1);
    });
  for(const windSpeed of [8,20,40])for(const degrees of [0,90])
    it(`advances and turns steadily in wind speed ${windSpeed} toward ${degrees} degrees`,()=>{
      const game=scene(0,windSpeed),ship=game.spawnUnit('player','transport',1400,1500),angle=degrees*Math.PI/180;
      const goal={x:ship.x+300*Math.cos(angle),y:ship.y+300*Math.sin(angle)};
      issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
      let changes=0,previous:string|undefined;const modes=new Set<string>();
      for(let tick=0;tick<seconds(50)&&ship.order.type==='move';tick++){
        stepGame(game);const mode=ship.sailing!.sail!.mode;modes.add(mode);
        if(mode!==previous){changes++;previous=mode;}
      }
      expect(ship.order.type).toBe('idle');expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(1);
      expect(modes.has('tacking')).toBe(false);expect(changes).toBeLessThan(5);
    });
  it('chooses the clear tack side beside a coast and around another hull',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',1000,800),goal={x:1600,y:800,heading:0};
    game.map.terrain!.cells=Array.from({length:7500},(_,i)=>Math.floor(i/100)>=23?'.':'~').join('');
    const coast=shipTackRoute(game.map,ship,goal,shipTraffic(ship,game.units))!;
    expect(coast).toHaveLength(2);expect(coast[0]!.y).toBeLessThan(ship.y);
    game.map.terrain!.cells='~'.repeat(7500);
    const preferred=shipTackRoute(game.map,ship,goal,shipTraffic(ship,game.units))!;
    game.spawnUnit('enemy','cutter',preferred[0]!.x,preferred[0]!.y);
    const clear=shipTackRoute(game.map,ship,goal,shipTraffic(ship,game.units))!;
    expect((clear[0]!.y-ship.y)*(preferred[0]!.y-ship.y)).toBeLessThan(0);
  });
  it('uses bounded assistance in a calm and for an explicit upwind berth',()=>{
    for(const calm of [false,true]){
      const game=scene(Math.PI,calm?0:80),ship=game.spawnUnit('player','transport',1000,1500),goal={x:1100,y:1500};
      issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
      if(!calm && ship.order.type==='move')ship.order.heading=0;
      const limit=coursePerformance(ship,game.map).auxiliarySpeed;
      for(let tick=0;tick<seconds(15)&&ship.order.type==='move';tick++){
        const before={x:ship.x,y:ship.y};stepGame(game);
        expect(Math.hypot(ship.x-before.x,ship.y-before.y)).toBeLessThanOrEqual(perTick(limit)+1e-6);
        expect(ship.sailing!.route?.points.some(point=>point.tack)).not.toBe(true);
      }
      expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(1);
    }
  });
  it('uses a narrow upwind channel without repeatedly trying impossible tacks',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',1000,1500),goal={x:1450,y:1500};
    game.map.terrain!.cells=Array.from({length:7500},(_,i)=>Math.floor(i/100)>=36 && Math.floor(i/100)<=38?'~':'.').join('');
    expect(hullFits(game.map,ship)).toBe(true);
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    stepGame(game);const route=ship.sailing!.route;
    expect(route!.points.some(point=>point.tack)).toBe(false);
    for(let tick=0;tick<seconds(45)&&ship.order.type==='move';tick++){
      stepGame(game);expect(hullFits(game.map,ship)).toBe(true);expect(ship.sailing!.route).toBe(route);
      expect(ship.sailing!.speed).toBeLessThanOrEqual(coursePerformance(ship,game.map).auxiliarySpeed+1e-7);
    }
    expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(1);
  });
  it('brakes forward momentum before a precise astern berth and respects auxiliary speed',()=>{
    const game=scene(0),ship=game.spawnUnit('player','transport',1000,1500);
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:3000,y:1500});
    for(let tick=0;tick<seconds(10);tick++)stepGame(game);
    const auxiliary=coursePerformance(ship,game.map).auxiliarySpeed,start=ship.x,goal={x:ship.x-30,y:ship.y};
    expect(ship.sailing!.speed).toBeGreaterThan(auxiliary*2);
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    if(ship.order.type==='move')ship.order.heading=0;
    stepGame(game);expect(ship.x).toBe(start);expect(ship.sailing!.speed).toBe(0);
    for(let tick=0;tick<seconds(8)&&ship.order.type==='move';tick++){
      const before=ship.x;stepGame(game);
      const astern=before-ship.x;
      expect(astern).toBeGreaterThanOrEqual(-1e-7);expect(astern).toBeLessThanOrEqual(perTick(auxiliary)+1e-7);
      expect(ship.sailing!.speed).toBeCloseTo(astern*20,6);
    }
    expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(1);
  });
  it('does not convert cruise momentum into an over-speed bow-pivot maneuver',()=>{
    const game=scene(0),ship=game.spawnUnit('player','transport',1000,1500);
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:3000,y:1500});
    for(let tick=0;tick<seconds(10);tick++)stepGame(game);
    const auxiliary=coursePerformance(ship,game.map).auxiliarySpeed,lever=92;
    const pivot={x:ship.x-lever,y:ship.y},goal={x:pivot.x+lever*Math.cos(Math.PI/4),y:pivot.y+lever*Math.sin(Math.PI/4)};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    ship.sailing!.route={goalX:goal.x,goalY:goal.y,points:[{...goal,heading:Math.PI/4,pivot}],end:goal};
    for(let tick=0;tick<seconds(2);tick++){
      const before=ship.sailing!.heading;stepGame(game);
      const arcSpeed=lever*Math.abs(headingDifference(before,ship.sailing!.heading))*20;
      expect(arcSpeed).toBeLessThanOrEqual(auxiliary+1e-7);expect(ship.sailing!.speed).toBeCloseTo(arcSpeed,6);
      expect(hullFits(game.map,ship)).toBe(true);
    }
  });
  it('retries tacking after leaving a narrow channel and preserves the retry through a save',()=>{
    const game=scene();
    game.map.terrain!.cells=Array.from({length:7500},(_,i)=>i%100>=25 || Math.floor(i/100)>=36 && Math.floor(i/100)<=38?'~':'.').join('');
    const ship=game.spawnUnit('player','transport',600,1500),goal={x:2600,y:1500};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    for(let tick=0;tick<seconds(20);tick++)stepGame(game);
    expect(ship.sailing!.route!.windTried).toBe(true);expect(ship.sailing!.route!.points.some(point=>point.tack)).toBe(false);
    const restored=scene();restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    let tacked=false,tries=0,lastTry=ship.sailing!.route!.windTryX;
    for(let tick=0;tick<seconds(200)&&ship.order.type==='move';tick++){
      stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));
      expect(hullFits(game.map,ship)).toBe(true);
      if(ship.sailing!.route?.points.some(point=>point.tack))tacked=true;
      const attempt=ship.sailing!.route?.windTryX;if(attempt!==lastTry){tries++;lastTry=attempt;}
    }
    expect(tacked).toBe(true);expect(tries).toBeLessThan(20);
    expect(ship.order.type).toBe('idle');expect(Math.hypot(ship.x-goal.x,ship.y-goal.y)).toBeLessThan(1);
  });
  it('resumes halfway through a tack and replans once when the wind changes',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',1400,1500),goal={x:2050,y:1500};
    issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal});
    for(let tick=0;tick<seconds(8);tick++)stepGame(game);
    expect(ship.sailing!.route?.points.some(point=>point.tack)).toBe(true);
    const restored=scene();restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    for(let tick=0;tick<seconds(8);tick++){stepGame(game);stepGame(restored);expect(checksumGame(restored)).toBe(checksumGame(game));}
    const old=ship.sailing!.route;
    game.map.wind={direction:0,speed:80};stepGame(game);
    expect(ship.sailing!.route).not.toBe(old);expect(ship.sailing!.route!.windKey).toBe(getWind(game.map).key);
    expect(ship.sailing!.route!.points.some(point=>point.tack)).toBe(false);
  });
  it('cannot tack with a destroyed rudder or gain auxiliary propulsion from destroyed rigging',()=>{
    for(const part of ['rudder','rigging'] as const){
      const game=scene(),ship=game.spawnUnit('player','transport',1400,1500);
      ship.shipParts={...shipPartMax(ship),[part]:0};
      issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:2050,y:1500});
      for(let tick=0;tick<seconds(4);tick++)stepGame(game);
      expect(ship.sailing!.heading).toBe(0);
      expect(ship.x).toBe(1400);expect(ship.y).toBe(1500);
      if(part==='rigging')expect(shipMotionLimits(ship).speed).toBe(0);
    }
  });
});
