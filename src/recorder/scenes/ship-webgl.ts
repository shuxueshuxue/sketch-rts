import { createGame } from '../../shared/sim';
import { createBuilding } from '../../shared/map';
import { boardUnit, deckPlacement, syncDecks } from '../../shared/decks';

/** One ordinary warship and an inert shore target, sharing match physics. */
export function createShipWebglScene() {
  const game=createGame('bareDuel',{aiPlayers:[],scenario:{replaceDefaultUnits:true,replaceDefaultBuildings:true,replaceDefaultResources:true,replaceDefaultMercenaryCamps:true,replaceDefaultLandmarks:true}});
  game.scriptedVictory=true;
  game.map={...game.map,width:1800,height:1400,terrain:{cell:40,cols:45,rows:35,cells:Array.from({length:35},(_,row)=>(row<15?'.':'~').repeat(45)).join('')}};
  const ship=game.spawnUnit('player','warship',900,850);
  ship.order={type:'hold',x:ship.x,y:ship.y};
  for(const [kind,x,y] of [['footman',-20,12],['worker',8,-18]] as const){
    const crew=game.spawnUnit('player',kind,ship.x,ship.y);
    if(!boardUnit(ship,crew,game.units))throw new Error('Preview crew must fit on the physical deck');
    const point=deckPlacement(ship,crew,game.units,{x,y});
    if(point)crew.deck={shipId:ship.id,...point};
  }
  const target=createBuilding('shore-target','enemy','farm',995,540,true);target.hp=target.maxHp=10000;game.buildings.push(target);
  syncDecks(game.units);
  return {game,ship,target};
}
