import { describe,expect,it } from 'vitest';
import { createGame,issuePlayerCommand,stepGame,snapshotGame,leadershipRegenPerSecond } from './sim';
import { commandValidationError } from './sim/command-validation';
import { castCommandForSelection } from '../client/ability-targeting';
import { boardUnit } from './decks';
import { seconds } from './time';
function scene(){const game=createGame('bareDuel',{aiPlayers:[]});game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;delete game.map.terrain;return game;}
describe('medical healing and hull repairs',()=>{
  for(const [kind,ability] of [['priest','heal'],['emberAcolyte','emberMend']] as const)it(`rejects manual ${ability} on a hull at both selection and simulation admission`,()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',900,800),healer=game.spawnUnit('player',kind,900,740);ship.hp-=100;
    const command={type:'cast' as const,unitId:healer.id,ability,targetId:ship.id};
    expect(commandValidationError(snapshotGame(game),'player',command)).toBe('Healing cannot repair ships');
    expect(castCommandForSelection(snapshotGame(game),'player',[healer],ability,{targetId:ship.id})).toBeUndefined();
    expect(()=>issuePlayerCommand(game,'player',command)).toThrow('Healing cannot repair ships');
  });
  it('heals wounded deck crew automatically and leaves their hull untouched',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',900,800),crew=game.spawnUnit('player','footman',900,800),healer=game.spawnUnit('player','priest',900,740);
    boardUnit(ship,crew,game.units);ship.hp-=150;crew.hp-=50;const hull=ship.hp,hp=crew.hp;
    for(let i=0;i<seconds(.1);i++)stepGame(game);expect(crew.hp).toBeGreaterThan(hp);expect(ship.hp).toBe(hull);
    expect(healer.abilityCooldowns?.heal).toBeGreaterThan(0);
  });
  it('cancels old queued hull-healing orders without consuming a spell',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',900,800),healer=game.spawnUnit('player','priest',900,740);
    ship.hp-=150;const hp=ship.hp;healer.autocast={heal:false};healer.order={type:'cast',ability:'heal',targetId:ship.id};
    stepGame(game);expect(healer.order.type).toBe('idle');expect(healer.abilityCooldowns?.heal ?? 0).toBe(0);expect(ship.hp).toBe(hp);
  });
  it('does not repair hulls with scrolls or veteran regeneration, while workers still repair them',()=>{
    const game=scene(),ship=game.spawnUnit('player','transport',900,800),crew=game.spawnUnit('player','footman',900,800),worker=game.spawnUnit('player','worker',900,800);
    boardUnit(ship,crew,game.units);boardUnit(ship,worker,game.units);ship.hp-=100;crew.hp-=50;worker.order={type:'hold',x:worker.x,y:worker.y};
    ship.level=2;game.players.player!.upgrades.leadership=3;const hp=ship.hp;
    game.items.push({id:'scroll',kind:'healingScroll',carrierId:crew.id,slot:'carry0',x:crew.x,y:crew.y,cooldownRemaining:0});
    issuePlayerCommand(game,'player',{type:'useItem',unitId:crew.id,itemId:'scroll'});
    expect(crew.hp).toBe(crew.maxHp);expect(ship.hp).toBe(hp);expect(leadershipRegenPerSecond(game,ship)).toBe(0);
    worker.order={type:'idle'};game.players.player!.gold=100;
    for(let i=0;i<seconds(1);i++)stepGame(game);
    expect(ship.hp).toBeGreaterThan(hp);
  });
});
