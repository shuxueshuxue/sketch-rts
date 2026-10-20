import {createBuilding} from '../shared/map';
import {it,expect} from 'vitest';
import {createGame,issuePlayerCommand,stepGame} from '../shared/sim';
import {AiPlanObserver} from './plan-observer';
import type {AiPlanPacket} from './plan-stream';
it('records a building loss only after real lethal damage and native removal',()=>{
 const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.buildings=[];game.scriptedVictory=true;delete game.map.terrain;
 const target=createBuilding('witness-tower','enemy','defenseTower',1000,1000,true);game.buildings.push(target);target.hp=1;
 const unit=game.spawnUnit('player','footman',900,1000);unit.attackDamage=500;
 const packets:AiPlanPacket[]=[],observer=new AiPlanObserver(game,[]);observer.subscribe(p=>packets.push(p));
 issuePlayerCommand(game,'player',{type:'attack',unitIds:[unit.id],targetId:target.id});
 for(let i=0;i<100&&game.buildings.includes(target);i++){stepGame(game);observer.step();}
 expect(target.hp).toBeLessThanOrEqual(0);expect(game.buildings.includes(target)).toBe(false);
 const losses=packets.flatMap(p=>p.type==='events'?p.buildings:[]);
 expect(losses).toHaveLength(1);expect(losses[0]).toMatchObject({id:target.id,owner:'enemy',kind:'defenseTower',x:target.x,y:target.y});
 observer.dispose();
});
it('does not turn an alive building disappearing from the world into a combat loss',()=>{
 const game=createGame('bareDuel',{aiPlayers:[]}),target=game.buildings.find(b=>b.owner==='enemy')!;
 const packets:AiPlanPacket[]=[],observer=new AiPlanObserver(game,[]);observer.subscribe(p=>packets.push(p));
 game.buildings=game.buildings.filter(b=>b!==target);stepGame(game);observer.step();
 expect(target.hp).toBeGreaterThan(0);expect(packets.flatMap(p=>p.type==='events'?p.buildings:[])).toEqual([]);observer.dispose();
});
