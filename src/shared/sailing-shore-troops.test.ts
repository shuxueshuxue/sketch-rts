import {expect,it} from 'vitest';
import {sketchScene} from '../sdk/scene';
import {createGame,issuePlayerCommand,restoreSnapshotIntoGame,snapshotGame,stepGame} from './sim';
import {hullFits} from './ship-navigation';
import terrain from './shore-departure.fixture.json';

// Cropped native coast from the 96,000-tick archipelago match. The two
// disembarked soldiers touch the bow: an in-place turn is not executable.
it.each([false,true])('backs away from shore troops before turning (mirror=%s)',mirror=>{
 const x=(value:number)=>mirror?2048-value:value;
 const game=sketchScene('shore-troop-departure').map('bareDuel').replaceDefaults()
  .player('us',{team:'a'})
  .unit('us','transport',x(1190.8485100764137),1281.063742658286,{id:'boat'})
  .unit('us','footman',x(1209.015735659861),1416.182917704474,{id:'bow-right',order:{type:'hold',x:x(1209.015735659861),y:1416.182917704474}})
  .unit('us','footman',x(1169.198063735059),1399.669734733165,{id:'bow-left',order:{type:'hold',x:x(1169.198063735059),y:1399.669734733165}})
  .build().createGame();
 game.scriptedVictory=true;game.map.width=2048;game.map.height=2048;
 game.map.terrain={...terrain,cells:mirror?Array.from({length:64},(_,y)=>terrain.cells.slice(y*64,(y+1)*64).split('').reverse().join('')).join(''):terrain.cells};
 const boat=game.units.find(u=>u.id==='boat')!;
 boat.sailing={...boat.sailing!,heading:mirror?Math.PI+4.767474638162432:-4.767474638162432,speed:0};
 const start={x:boat.x,y:boat.y},health=game.units.map(u=>({id:u.id,hp:u.hp}));
 issuePlayerCommand(game,'us',{type:'move',unitIds:[boat.id],x:x(1800),y:900,avoidCombat:true});
 let restored:ReturnType<typeof createGame>|undefined;
 for(let tick=0;tick<1200;tick++){
  stepGame(game);if(restored)stepGame(restored);
  if(tick===60){restored=createGame('bareDuel');restored.scriptedVictory=true;restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);}
  expect(hullFits(game.map,boat)).toBe(true);
 }
 expect(snapshotGame(restored!)).toEqual(snapshotGame(game));
 expect(restored!.nextId).toBe(game.nextId);
 expect(Math.hypot(boat.x-start.x,boat.y-start.y)).toBeGreaterThan(500);
 expect(game.units.map(u=>({id:u.id,hp:u.hp}))).toEqual(health);
});
