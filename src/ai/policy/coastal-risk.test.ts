import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { outmatchingCoast } from './coastal-risk';
import { planNavalTactics } from './naval';

function shore() {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
  game.map.width=game.map.height=3200;
  game.map.terrain={cell:32,cols:100,rows:100,cells:Array.from({length:100},()=>'.'.repeat(25)+'~'.repeat(75)).join('')};
  const ship=game.spawnUnit('player','warship',1150,1600);ship.sailing!.heading=0;
  for(let i=0;i<16;i++)game.spawnUnit('enemy','sparkArcher',720-(i%4)*30,1500+Math.floor(i/4)*35);
  const memory=createAiPolicyMemory();
  const context=()=>bootstrapPolicyContext(snapshotGame(game),'player','v9_archer',{memory});
  return {game,ship,context};
}
describe('fleet coastal risk',()=>{
  it('rejects a shore firing squad before the battery enters its range and survives an ordinary retreat',()=>{
    const {game,ship,context}=shore();
    expect(outmatchingCoast(snapshotGame(game),'player',ship,ship,context()).length).toBeGreaterThan(0);
    const commands=planNavalTactics(snapshotGame(game),'player',context());
    expect(commands).toContainEqual(expect.objectContaining({type:'move',unitIds:[ship.id],avoidCombat:true}));
    for(const command of commands)issuePlayerCommand(game,'player',command);
    for(let i=0;i<600;i++)stepGame(game);
    expect(ship.hp).toBe(ship.maxHp);expect(ship.x).toBeGreaterThan(1600);
  });
  it('counts nearby landed support, but does not count the same army far away',()=>{
    const {game,ship,context}=shore();
    const army=Array.from({length:40},(_,i)=>game.spawnUnit('player','archer',700,1600+i));
    expect(outmatchingCoast(snapshotGame(game),'player',ship,ship,context())).toEqual([]);
    for(const unit of army)unit.y=100;
    expect(outmatchingCoast(snapshotGame(game),'player',ship,ship,context()).length).toBeGreaterThan(0);
  });
  it('does not turn inland melee soldiers into a threat to deep-water ships',()=>{
    const {game,ship,context}=shore();
    game.units=game.units.filter(unit=>unit.owner==='player');
    for(let i=0;i<30;i++)game.spawnUnit('enemy','footman',740,1500+i*4);
    expect(outmatchingCoast(snapshotGame(game),'player',ship,{x:1000,y:1600},context())).toEqual([]);
  });
});
