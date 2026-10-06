import { describe,expect,it } from 'vitest';
import { createGame,issuePlayerCommand,stepGame,snapshotGame,restoreSnapshotIntoGame } from './sim';
import { boardUnit,deckPlacement,deckPointFits,syncDecks } from './decks';
import { hullContact } from './ship-geometry';
import { hullFits } from './ship-navigation';
import { targetCommand } from '../client/relations';
import { commandValidationError,narrowFrameCommandToLiveOperands } from './sim/command-validation';
import { seconds } from './time';
import { checksumGame } from './sim/checksum';
function scene(){const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;game.map.width=2400;game.map.height=1800;game.map.terrain={cell:40,cols:60,rows:45,cells:'~'.repeat(2700)};return game;}
describe('right-click crew rendezvous',()=>{
  for(const owner of ['player','enemy'] as const)it(`approaches, walks across and transfers crew to a separated ${owner} deck`,()=>{
    const game=scene(),source=game.spawnUnit('player','transport',700,800),target=game.spawnUnit(owner,'transport',1250,950);
    const crew=['footman','worker','archer'].map(kind=>game.spawnUnit('player',kind as 'footman',700,800));
    for(const unit of crew)expect(boardUnit(source,unit,game.units)).toBe(true);
    source.sailing!.heading=0;target.sailing!.heading=owner==='player'?Math.PI:0;
    const command=targetCommand(snapshotGame(game),'player',crew,{kind:'unit',unit:target})!;
    expect(command.type).toBe('board');expect(commandValidationError(snapshotGame(game),'player',command)).toBeUndefined();
    expect(narrowFrameCommandToLiveOperands(game,'player',command)).toEqual(command);
    issuePlayerCommand(game,'player',command);
    const before={x:target.x,y:target.y};let transferred=0;
    for(let i=0;i<seconds(60)&&transferred<crew.length;i++){
      stepGame(game);for(const ship of [source,target])expect(hullFits(game.map,ship)).toBe(true);
      expect(hullContact(source,target)?.overlap ?? 0).toBeLessThan(.1);
      for(const unit of crew){expect(unit.hp).toBeGreaterThan(0);expect(unit.deck).toBeDefined();}
      transferred=crew.filter(unit=>unit.deck?.shipId===target.id && unit.order.type==='idle' && deckPointFits(target,unit,unit.deck,game.units)).length;
    }
    expect(transferred).toBe(crew.length);expect(target.owner).toBe('player');
    if(owner==='player')expect(Math.hypot(target.x-before.x,target.y-before.y)).toBeGreaterThan(20);
    else expect({x:target.x,y:target.y}).toEqual(before);
  });
  it('uses the same arrival geometry on an authored scene without a terrain grid',()=>{
    const game=scene();delete game.map.terrain;
    const source=game.spawnUnit('player','warship',900,900),target=game.spawnUnit('player','warship',1160,900),crew=game.spawnUnit('player','worker',900,900);
    boardUnit(source,crew,game.units);syncDecks(game.units);
    issuePlayerCommand(game,'player',{type:'board',unitIds:[crew.id],transportId:target.id});
    for(let i=0;i<seconds(60);i++)stepGame(game);
    expect(crew.deck?.shipId).toBe(target.id);
  });
  it('cancels implicit approach when the player gives either participating ship a fresh order',()=>{
    for(const receiver of [false,true]){
      const game=scene(),source=game.spawnUnit('player','transport',700,800),target=game.spawnUnit('player','transport',1300,950),crew=game.spawnUnit('player','footman',700,800);
      boardUnit(source,crew,game.units);issuePlayerCommand(game,'player',{type:'board',unitIds:[crew.id],transportId:target.id});
      stepGame(game);expect(source.order.type).toBe('move');expect(target.order.type).toBe('move');
      const chosen=receiver?target:source;issuePlayerCommand(game,'player',{type:'stop',unitIds:[chosen.id]});
      expect(crew.order.type).toBe('idle');expect(source.order.type).toBe('idle');expect(target.order.type).toBe('idle');
      for(let i=0;i<seconds(2);i++)stepGame(game);
      expect(crew.deck?.shipId).toBe(source.id);
    }
  });
  it('stops implicit ship movement when its crew receives a replacement task',()=>{
    const game=scene(),source=game.spawnUnit('player','transport',700,800),target=game.spawnUnit('player','transport',1300,950),crew=game.spawnUnit('player','worker',700,800);
    boardUnit(source,crew,game.units);issuePlayerCommand(game,'player',{type:'board',unitIds:[crew.id],transportId:target.id});stepGame(game);
    issuePlayerCommand(game,'player',{type:'stop',unitIds:[crew.id]});stepGame(game);
    expect(source.order.type).toBe('idle');expect(target.order.type).toBe('idle');expect(crew.deck?.shipId).toBe(source.id);
  });
  it('does not commandeer a defended enemy ship while boarding it',()=>{
    const game=scene(),source=game.spawnUnit('player','transport',700,800),target=game.spawnUnit('enemy','transport',1250,950),crew=game.spawnUnit('player','worker',700,800),defender=game.spawnUnit('enemy','worker',1250,950);
    boardUnit(source,crew,game.units);boardUnit(target,defender,game.units);defender.deck={shipId:target.id,...deckPlacement(target,defender,game.units,{x:70,y:0})!};syncDecks(game.units);
    defender.attackDamage=0;defender.order={type:'hold',x:defender.x,y:defender.y};
    issuePlayerCommand(game,'player',{type:'board',unitIds:[crew.id],transportId:target.id});
    for(let i=0;i<seconds(45);i++)stepGame(game);
    expect(crew.deck?.shipId).toBe(target.id);expect(crew.order.type).toBe('idle');expect(target.owner).toBe('enemy');expect([target.x,target.y]).toEqual([1250,950]);
  });
  it('resumes a mid-rendezvous save deterministically',()=>{
    const game=scene(),source=game.spawnUnit('player','transport',700,800),target=game.spawnUnit('player','transport',1300,950),crew=game.spawnUnit('player','footman',700,800);
    boardUnit(source,crew,game.units);issuePlayerCommand(game,'player',{type:'board',unitIds:[crew.id],transportId:target.id});
    for(let i=0;i<seconds(2);i++)stepGame(game);
    const restored=scene();restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    for(let i=0;i<seconds(45);i++){stepGame(game);stepGame(restored);}
    expect(checksumGame(game)).toBe(checksumGame(restored));expect(crew.deck?.shipId).toBe(target.id);
  });
});
