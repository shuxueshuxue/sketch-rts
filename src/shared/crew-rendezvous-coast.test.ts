import {expect,it} from 'vitest';
import {navalServices} from '../ai/policy/naval-services';
import {createAiPolicyMemory} from '../ai/memory';
import {boardUnit,syncDecks} from './decks';
import {createGame,issuePlayerCommand,snapshotGame,stepGame} from './sim';
import {hullFits} from './ship-navigation';
import {isWalkable} from './terrain';

it.each([false,true])('meets beside a headland when the midpoint is land, with repeated service planning=%s',services=>{
 const game=createGame('bareDuel',{aiPlayers:[]});
 game.units=[];game.buildings=[];game.resources=[];game.items=[];game.obstacles=[];game.mercenaryCamps=[];game.scriptedVictory=true;
 game.map={...game.map,width:4096,height:4096,terrain:{cell:32,cols:128,rows:128,
  cells:Array.from({length:128*128},(_,i)=>{const x=(i%128+.5)*32,y=(Math.floor(i/128)+.5)*32;return x>=1700&&x<=2300&&y>=1500&&y<=2500?'.':'~';}).join('')}};
 const source=game.spawnUnit('player','warship',1500,1800),target=game.spawnUnit('player','transport',2100,2700);
 source.sailing!.heading=target.sailing!.heading=0;
 const worker=game.spawnUnit('player','worker',1500,1800);expect(boardUnit(source,worker,game.units)).toBe(true);syncDecks(game.units);
 target.hp=Math.floor(target.maxHp*.5);const before=target.hp;
 expect(isWalkable(game.map,(source.x+target.x)/2,(source.y+target.y)/2,'sea')).toBe(false);
 expect(hullFits(game.map,source)&&hullFits(game.map,target)).toBe(true);
 issuePlayerCommand(game,'player',{type:'board',unitIds:[worker.id],transportId:target.id});
 stepGame(game);
 expect(worker.order.type==='board'&&worker.order.rendezvous).toBeTruthy();
 const options={version:'v8' as const,memory:createAiPolicyMemory()};
 for(let tick=0;tick<6000 && (worker.deck?.shipId!==target.id||target.hp<=before);tick++){
  if(services && tick%15===0)for(const command of navalServices(snapshotGame(game),'player',options).commands)issuePlayerCommand(game,'player',command);
  stepGame(game);
 }
 expect(worker.deck?.shipId,JSON.stringify({source,target,worker})).toBe(target.id);
 expect(target.hp).toBeGreaterThan(before);
 expect(source.hp).toBe(source.maxHp);
 expect(snapshotGame(game).match.stats.unitsLost.player).toBe(0);
},60000);
