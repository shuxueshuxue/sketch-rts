import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, stepGame } from './sim';
import { automaticShoreTargetReachable, shoreFiringStation } from './shore-fire';
import { canReach } from './naval';
import { hullFits } from './ship-navigation';
import { installedWeapons } from './ship-equipment';

function coast(kind: 'warship' | 'bombardShip' = 'warship', inland = 295) {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
  game.map.width=game.map.height=1600;
  game.map.terrain={cell:32,cols:50,rows:50,cells:Array.from({length:50},()=>'.'.repeat(25)+'~'.repeat(25)).join('')};
  const ship=game.spawnUnit('player',kind,1000,800);
  ship.sailing!.heading=Math.PI;
  const target=game.spawnUnit('enemy','deepSnapper',800-inland,800);
  target.order={type:'hold',x:target.x,y:target.y};
  return {game,ship,target};
}

describe('automatic shore engagements',()=>{
  it('rejects a point-water false positive without cancelling an explicit attack',()=>{
    const {game,ship,target}=coast();
    expect(canReach(game.map,ship,target,game.units)).toBe(true);
    expect(automaticShoreTargetReachable(game,ship,target)).toBe(false);
    issuePlayerCommand(game,'player',{type:'attackMove',unitIds:[ship.id],x:1100,y:1200});
    for(let i=0;i<20;i++)stepGame(game);
    expect('targetId' in ship.order && ship.order.targetId===target.id).toBe(false);
    issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:target.id});
    stepGame(game);
    expect(ship.order.type).toBe('attack');
    expect('targetId' in ship.order && ship.order.targetId).toBe(target.id);
  });
  it('keeps a reachable coastal target and actually fires on it',()=>{
    const {game,ship,target}=coast('warship',100);
    const pose=shoreFiringStation(game,ship,target)!;
    expect(pose).toBeDefined();expect(hullFits(game.map,ship,pose)).toBe(true);
    issuePlayerCommand(game,'player',{type:'attackMove',unitIds:[ship.id],x:900,y:800});
    const hp=target.hp;
    for(let i=0;i<600;i++)stepGame(game);
    expect(target.hp).toBeLessThan(hp);
  });
  it('uses the installed mortar and invalidates a destroyed gun',()=>{
    const {game,ship,target}=coast('bombardShip');
    expect(automaticShoreTargetReachable(game,ship,target)).toBe(true);
    for(const item of installedWeapons(game,ship))item.durability=0;
    expect(automaticShoreTargetReachable(game,ship,target)).toBe(false);
  });
  it('reconsiders a formerly unreachable target after it approaches the beach',()=>{
    const {game,ship,target}=coast();
    expect(automaticShoreTargetReachable(game,ship,target)).toBe(false);
    target.x=700;
    expect(automaticShoreTargetReachable(game,ship,target)).toBe(true);
  });
});
