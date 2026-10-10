import { describe,expect,it } from 'vitest';
import { boltIntersection } from './weapons';
import { strikePoint } from './combat-geometry';
import { createBuilding, createUnit } from './map';
import { distanceToHull, SHIP_KINDS } from './ship-geometry';
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
  it('hits every hull surface after heading and scale changes without reusing old world geometry',()=>{
    for(const kind of SHIP_KINDS){
      const ship=createUnit('target','enemy',kind,800,800);
      for(const scale of [.8,1.1,1.5]){
        ship.deckScale=scale;
        for(const heading of [0,Math.PI/3,-Math.PI*.7]){
          ship.sailing={heading,speed:0,load:0,balance:0};
          const inside={x:ship.x,y:ship.y};
          expect(strikePoint(inside,ship)).toBe(inside);
          for(let angle=0;angle<360;angle+=5){
            const from={x:800+600*Math.cos(angle*Math.PI/180),y:800+600*Math.sin(angle*Math.PI/180)};
            const point=strikePoint(from,ship);
            expect(distanceToHull(ship,point),`${kind}/${scale}/${heading}/${angle}`).toBeLessThan(1e-7);
            expect(boltIntersection(from,point,ship,6)).toBeDefined();
            const before={x:point.x+(from.x-point.x)*.05,y:point.y+(from.y-point.y)*.05};
            expect(boltIntersection(from,before,ship,0)).toBeUndefined();
          }
        }
      }
    }
  });
  it('finishes real aimed ship cannon shots against a farm and continues firing',()=>{
    const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.scriptedVictory=true;delete game.map.terrain;
    const ship=game.spawnUnit('player','warship',800,800),farm=createBuilding('farm','enemy','farm',1051,873,true);farm.hp=farm.maxHp=5000;game.buildings.push(farm);
    issuePlayerCommand(game,'player',{type:'attack',unitIds:[ship.id],targetId:farm.id});let shots=0,aimed=false;
    for(let tick=0;tick<seconds(12);tick++){stepGame(game);shots+=game.effects.filter(effect=>effect.type==='muzzleFlash' && effect.remaining===effect.duration).length;aimed ||= game.items.some(item=>item.shipId===ship.id && !!item.aim);}
    expect(aimed).toBe(true);expect(shots).toBeGreaterThanOrEqual(3);expect(farm.hp).toBeLessThan(5000-40);
  });
});
