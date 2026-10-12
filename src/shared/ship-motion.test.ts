import { describe,expect,it } from 'vitest';
import { createGame,issuePlayerCommand,stepGame } from './sim';
import { advanceShip,beginShipMotionFrame,shipMotionLimits } from './ship-motion';
import { sailToward } from './sailing';
import { headingDifference,hullFits } from './ship-navigation';
import { shove } from './push';
import { perTick,seconds } from './time';
function scene(terrain=true){const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;game.map.width=2000;game.map.height=1600;if(terrain)game.map.terrain={cell:40,cols:50,rows:40,cells:'~'.repeat(2000)};else delete game.map.terrain;return game;}
describe('engine-owned ship motion',()=>{
  it('shares speed and yaw budgets across repeated movement, weapon and impulse requests',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',800,800),start={x:ship.x,y:ship.y,heading:ship.sailing!.heading},limits=shipMotionLimits(ship);
    beginShipMotionFrame(game.units);
    for(let i=0;i<8;i++)advanceShip(ship,game.map,game.units,{surge:999,yaw:999});
    expect(Math.abs(headingDifference(start.heading,ship.sailing!.heading))).toBeLessThanOrEqual(perTick(limits.turnRate)+1e-7);
    expect(Math.hypot(ship.x-start.x,ship.y-start.y)).toBeLessThanOrEqual(perTick(limits.speed)+1e-7);
    expect(advanceShip(ship,game.map,game.units,{surge:NaN})).toBe(false);
    expect(advanceShip(ship,game.map,game.units,{pivotLever:NaN})).toBe(false);
  });
  it('enforces the lower astern speed even across repeated engine requests',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',800,800),limits=shipMotionLimits(ship);
    beginShipMotionFrame(game.units);
    for(let i=0;i<8;i++)advanceShip(ship,game.map,game.units,{surge:-999});
    expect(800-ship.x).toBeCloseTo(perTick(limits.reverseSpeed),6);expect(ship.y).toBe(800);
  });
  it('replenishes the retained yaw, travel and astern budgets only at the next frame',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',800,800),limits=shipMotionLimits(ship);
    for(let tick=0;tick<3;tick++){
      beginShipMotionFrame(game.units,game.map);
      const start={x:ship.x,y:ship.y,heading:ship.sailing!.heading};
      for(let i=0;i<8;i++)advanceShip(ship,game.map,game.units,{surge:-999,yaw:999});
      expect(Math.abs(headingDifference(start.heading,ship.sailing!.heading))).toBeCloseTo(perTick(limits.turnRate),6);
      expect(Math.hypot(ship.x-start.x,ship.y-start.y)).toBeCloseTo(perTick(limits.reverseSpeed),6);
    }
  });
  for(const terrain of [false,true])it(`cannot strafe under changing movement commands, terrain=${terrain}`,()=>{
    const game=scene(terrain),ship=game.spawnUnit('player','transport',800,800);
    for(let tick=0;tick<seconds(12);tick++){
      if(tick%seconds(1)===0)issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],x:tick%40?500:1300,y:tick%60?1100:500,avoidCombat:true});
      const before={x:ship.x,y:ship.y};stepGame(game);
      const heading=ship.sailing!.heading,lateral=(ship.x-before.x)*Math.sin(heading)-(ship.y-before.y)*Math.cos(heading);
      expect(Math.abs(lateral)).toBeLessThan(1e-6);expect(hullFits(game.map,ship)).toBe(true);
    }
  });
  it('does not repair overlaps or sideways knockback by silently relocating hulls',()=>{
    const game=scene(),a=game.spawnUnit('player','transport',800,800),b=game.spawnUnit('player','transport',800,820);
    b.x=a.x;b.y=a.y+20; // Deliberately corrupt placement; no runtime teleport may hide it.
    for(const boat of [a,b])boat.order={type:'hold',x:boat.x,y:boat.y};
    const before=[a,b].map(boat=>({x:boat.x,y:boat.y}));shove(a,0,1,50);stepGame(game);
    expect([a,b].map(boat=>({x:boat.x,y:boat.y}))).toEqual(before);
  });
  it('rejects an invalid route waypoint that asks for sideways translation',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',800,800);
    ship.sailing!.route={goalX:800,goalY:1000,points:[{x:800,y:1000,heading:0}],end:{x:800,y:1000},trafficKey:''};
    beginShipMotionFrame(game.units);sailToward(ship,{x:800,y:1000},game.map,game.units);
    expect([ship.x,ship.y]).toEqual([800,800]);expect(ship.sailing!.route).toBeUndefined();
  });
  it('refuses to create a hull when there is no usable water berth',()=>{
    const game=scene();game.map.terrain!.cells='.'.repeat(2000);
    const nextId=game.nextId;
    expect(()=>game.spawnUnit('player','transport',800,800)).toThrow(/water berth/);
    expect(game.units).toHaveLength(0);expect(game.nextId).toBe(nextId);
  });
});
