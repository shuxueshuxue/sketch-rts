import { describe,expect,it } from 'vitest';
import { boltIntersection } from './weapons';
import { strikePoint } from './combat-geometry';
import { createBuilding } from './map';
import { createGame,issuePlayerCommand,stepGame } from './sim';
import { seconds } from './time';
describe('shared projectile body contact',()=>{
  it('never misses a static building surface across 360 approach angles',()=>{
    const farm=createBuilding('farm','enemy','farm',800,800,true);
    for(let angle=0;angle<360;angle++){
      const from={x:800+300*Math.cos(angle*Math.PI/180),y:800+300*Math.sin(angle*Math.PI/180)};
      expect(boltIntersection(from,strikePoint(from,farm),farm,6),`angle ${angle}`).toBeDefined();
    }
    expect(boltIntersection({x:400,y:800},{x:650,y:800},farm,6)).toBeUndefined();
  });
  it('finishes real aimed ship cannon shots against a farm and continues firing',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.scriptedVictory=true;delete game.map.terrain;
    const ship=game.spawnUnit('player','warship',800,800),farm=createBuilding('farm','enemy','farm',1051,873,true);farm.hp=farm.maxHp=5000;game.buildings.push(farm);
    issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:farm.id});let shots=0,aimed=false;
    for(let tick=0;tick<seconds(12);tick++){stepGame(game);shots+=game.effects.filter(effect=>effect.type==='muzzleFlash' && effect.remaining===effect.duration).length;aimed ||= game.items.some(item=>item.shipId===ship.id && !!item.aim);}
    expect(aimed).toBe(true);expect(shots).toBeGreaterThanOrEqual(3);expect(farm.hp).toBeLessThan(5000-40);
  });
});
