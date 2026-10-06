import { targetCommand } from '../../client/relations';
import { boardUnit } from '../../shared/decks';
import { createGame, snapshotGame } from '../../shared/sim';
import { defineRecordingScene, timedCommands } from '../scene';

/** The same right-click command as a match, with separated ships and mixed crew. */
export default defineRecordingScene({
  name: 'crew-rendezvous',
  description: 'Two friendly ships approach and three crew members walk across the shared deck seam.',
  createGame() {
    const game=createGame('bareDuel',{aiPlayers:[],scenario:{replaceDefaultUnits:true,replaceDefaultBuildings:true,replaceDefaultResources:true,replaceDefaultMercenaryCamps:true,replaceDefaultLandmarks:true}});
    game.scriptedVictory=true;
    game.map={...game.map,width:2400,height:1800,terrain:{cell:40,cols:60,rows:45,cells:'~'.repeat(2700)}};
    const source=game.spawnUnit('player','transport',700,800),target=game.spawnUnit('player','transport',1250,950);
    target.sailing!.heading=Math.PI;
    for(const kind of ['footman','worker','archer'] as const){
      const crew=game.spawnUnit('player',kind,700,800);
      boardUnit(source,crew,game.units);
    }
    return game;
  },
  commands:timedCommands([{at:.5,commands:game=>{
    const target=game.units.filter(unit=>unit.kind==='transport')[1]!;
    const crew=game.units.filter(unit=>!!unit.deck);
    return [{playerId:'player',command:targetCommand(snapshotGame(game),'player',crew,{kind:'unit',unit:target})!}];
  }}]),
  defaults:{seconds:40,width:1280,height:720,fps:12,camera:{type:'fixed',x:975,y:875,zoom:1.6}},
});
