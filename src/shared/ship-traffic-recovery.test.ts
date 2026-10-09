import { afterEach, describe, expect, it, vi } from 'vitest';
import { hullContact, shipProfile } from './ship-geometry';
import * as navigation from './ship-navigation';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { seconds, SIM_TICKS_PER_SECOND } from './time';
import type { Unit } from './types';

function sea() {
  const game=createGame('bareDuel',{players:['player','enemy'],aiPlayers:[],teams:{player:'blue',enemy:'red'}});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.mercenaryCamps=[];game.scriptedVictory=true;
  game.map={...game.map,width:16384,height:16384,wind:{direction:Math.PI/4,speed:80},
    terrain:{cols:256,rows:256,cell:64,cells:'~'.repeat(256*256)}};
  return game;
}
afterEach(()=>vi.restoreAllMocks());

describe('ship traffic recovery',()=>{
  it('carries two crossing six-ship convoys through live traffic without repeated failed route searches',()=>{
    const game=sea(),fleet:Unit[]=[],goals=new Map<Unit,{x:number;y:number}>();
    for(let i=0;i<6;i++) {
      const east=game.spawnUnit('player',i%2?'transport':'shipOfTheLine',2300-i*390,6500);
      const south=game.spawnUnit('player',i%2?'warship':'transport',6400,2300-i*340);
      south.sailing!.heading=Math.PI/2;
      goals.set(east,{x:11000-i*390,y:6500});goals.set(south,{x:6400,y:11000-i*340});fleet.push(east,south);
    }
    for(const [ship,goal]of goals)issuePlayerCommand(game,'player',{type:'move',unitIds:[ship.id],...goal,avoidCombat:true});
    const planner=vi.spyOn(navigation,'planVoyageRoute');
    const history=new Map(fleet.map(ship=>[ship,{route:ship.sailing!.route,revisions:0,stopped:0,maxStopped:0}]));
    for(let tick=0;tick<seconds(240);tick++) {
      const positions=fleet.map(ship=>({x:ship.x,y:ship.y}));stepGame(game);
      fleet.forEach((ship,index)=>{
        const state=history.get(ship)!,motion=ship.sailing!,before=positions[index]!;
        if(state.route!==motion.route){if(motion.route)state.revisions++;state.route=motion.route;}
        state.stopped=ship.order.type!=='idle' && Math.hypot(ship.x-before.x,ship.y-before.y)*SIM_TICKS_PER_SECOND<1?state.stopped+1:0;
        state.maxStopped=Math.max(state.maxStopped,state.stopped);
      });
      if(tick%2===0) {
        for(const ship of fleet)expect(navigation.hullFits(game.map,ship),ship.id).toBe(true);
        for(let a=0;a<fleet.length;a++)for(let b=a+1;b<fleet.length;b++)expect(hullContact(fleet[a]!,fleet[b]!)?.overlap??0).toBeLessThan(.1);
      }
    }
    // The faulty controller completed over 1,800 rejected recovery searches,
    // rebuilt 208 routes and left one hull stationary for nearly 16 seconds.
    expect(planner.mock.calls.length).toBeLessThan(200);
    expect([...history.values()].reduce((sum,state)=>sum+state.revisions,0)).toBeLessThan(80);
    expect(Math.max(...[...history.values()].map(state=>state.maxStopped))/SIM_TICKS_PER_SECOND).toBeLessThan(10);
    for(const ship of fleet) {
      const goal=goals.get(ship)!;
      expect(ship.hp,ship.id).toBeGreaterThan(0);
      expect(1-Math.hypot(ship.x-goal.x,ship.y-goal.y)/8700,ship.id).toBeGreaterThanOrEqual(.85);
    }
  },30_000);

  function blocked() {
    const game=sea(),ship=game.spawnUnit('player','transport',1800,1800),other=game.spawnUnit('player','transport',2500,1800);
    const profile=shipProfile(ship)!;
    other.x=ship.x+Math.max(...profile.hull.map(point=>point.x))-Math.min(...profile.hull.map(point=>point.x))+.001;
    other.order={type:'hold',x:other.x,y:other.y};
    ship.order={type:'move',x:5000,y:1800,avoidCombat:true};
    ship.sailing!.speed=30;ship.sailing!.velocityX=30;ship.sailing!.velocityY=0;
    ship.sailing!.route={goalX:5000,goalY:1800,points:[{x:5000,y:1800,heading:0,exact:true}],end:{x:5000,y:1800},cruise:false};
    return{game,ship,other};
  }

  it('retains a physically blocked exact route and resumes the same waiting state through a JSON save',()=>{
    const {game,ship,other}=blocked(),route=ship.sailing!.route;
    for(let tick=0;tick<6;tick++)stepGame(game);
    expect(ship.sailing!.route).toBe(route);expect(ship.sailing!.speed).toBe(0);
    expect(hullContact(ship,other)?.overlap??0).toBeLessThan(.1);
    const resumed=sea();restoreSnapshotIntoGame(resumed,JSON.parse(JSON.stringify(snapshotGame(game))),game.nextId);
    for(let tick=0;tick<6;tick++){stepGame(game);stepGame(resumed);expect(checksumGame(resumed)).toBe(checksumGame(game));}
    for(const world of [game,resumed])issuePlayerCommand(world,'player',{type:'move',unitIds:[other.id],x:other.x,y:2600,avoidCombat:true});
    for(let tick=0;tick<seconds(90);tick++) {
      stepGame(game);stepGame(resumed);
      expect(checksumGame(resumed)).toBe(checksumGame(game));
      expect(hullContact(ship,other)?.overlap??0).toBeLessThan(.1);
      if(ship.order.type==='idle')break;
    }
    expect(ship.order.type).toBe('idle');expect(Math.hypot(ship.x-5000,ship.y-1800)).toBeLessThan(1);
  });

  it('reassesses a waiting route immediately when the actual wind changes',()=>{
    const {game,ship}=blocked();stepGame(game);
    const route=ship.sailing!.route;expect(route).toBeDefined();expect(route!.age??0).toBeLessThan(SIM_TICKS_PER_SECOND);
    game.map.wind={direction:Math.PI/2,speed:80,changedAtTick:game.tick};stepGame(game);
    expect(ship.sailing!.route).not.toBe(route);expect(ship.sailing!.route!.windKey).not.toBe(route!.windKey);
    expect(navigation.hullFits(game.map,ship)).toBe(true);
  });
});
