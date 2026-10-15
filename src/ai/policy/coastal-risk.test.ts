import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { coastalRefuge, outmatchingCoast } from './coastal-risk';
import { headingDifference, hullFits } from '../../shared/ship-navigation';
import { planNavalTactics } from './naval';
import { createBuilding } from '../../shared/map';

function shore() {
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.units=[];game.items=[];game.buildings=[];game.resources=[];game.scriptedVictory=true;
  game.map.width=game.map.height=3200;
  game.map.terrain={cell:32,cols:100,rows:100,cells:Array.from({length:100},()=>'.'.repeat(25)+'~'.repeat(75)).join('')};
  const ship=game.spawnUnit('player','warship',1150,1600);ship.sailing!.heading=0;
  for(let i=0;i<16;i++)game.spawnUnit('enemy','sparkArcher',720-(i%4)*30,1500+Math.floor(i/4)*35);
  const memory=createAiPolicyMemory();
  const context=()=>bootstrapPolicyContext(snapshotGame(game),'player','v9_archer',{memory});
  return {game,ship,context,memory};
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
  it('assesses a new shore engagement before sailing into the enemy army',()=>{
    const {game,ship,context}=shore();ship.x=1600;
    expect(outmatchingCoast(snapshotGame(game),'player',ship,ship,context())).toEqual([]);
    const commands=planNavalTactics(snapshotGame(game),'player',context());
    expect(commands).toContainEqual({type:'holdPosition',unitIds:[ship.id]});
    expect(commands.some(command=>command.type==='attackMove'&&command.unitIds.includes(ship.id))).toBe(false);
  });
  it('finishes the saved escape before reacquiring targets or returning a damaged hull to port',()=>{
    const {game,ship,context,memory}=shore();
    game.buildings.push(createBuilding('yard','player','shipyard',800,2700,true));
    const initial=planNavalTactics(snapshotGame(game),'player',context());
    for(const command of initial)issuePlayerCommand(game,'player',command);
    const retreat=memory.naval!.coastalRetreat![ship.id]!;
    expect(retreat).toBeDefined();
    ship.hp=ship.maxHp*.3;
    const restored=JSON.parse(JSON.stringify(memory));
    // Even if another controller changed the order, the serialized retreat
    // must restore its own waypoint rather than directing the hull to port.
    issuePlayerCommand(game,'player',{type:'stop',unitIds:[ship.id]});
    const snapshot=snapshotGame(game);
    const commands=planNavalTactics(snapshot,'player',bootstrapPolicyContext(snapshot,'player','v9_archer',{memory:restored}));
    expect(commands).toContainEqual({type:'move',unitIds:[ship.id],...retreat,avoidCombat:true});
    for(const command of commands)issuePlayerCommand(game,'player',command);
    const before=ship.hp;
    for(let i=0;i<600;i++)stepGame(game);
    expect(ship.hp).toBe(before);
  });
  it('chooses a side exit instead of a full turn back through the coastal firing zone',()=>{
    const {game,ship,context}=shore();ship.sailing!.heading=Math.PI;
    const snapshot=snapshotGame(game),threats=outmatchingCoast(snapshot,'player',ship,ship,context());
    const refuge=coastalRefuge(snapshot,ship,threats)!;
    expect(refuge).toBeDefined();
    expect(hullFits(game.map,ship,{...refuge,heading:ship.sailing!.heading})).toBe(true);
    const turn=Math.abs(headingDifference(ship.sailing!.heading,Math.atan2(refuge.y-ship.y,refuge.x-ship.x)));
    expect(turn).toBeLessThan(Math.PI*.75);
    expect(outmatchingCoast(snapshot,'player',ship,refuge,context())).toEqual([]);
  });
});

it('assesses the hull heading at the proposed firing station, not its departure heading',()=>{
 const {game,ship,context}=shore();ship.x=1600;ship.sailing!.heading=0;
 const snapshot=snapshotGame(game),station={x:1150,y:1600,heading:Math.PI/2};
 const posed={...ship,x:station.x,y:station.y,sailing:{...ship.sailing!,heading:station.heading}};
 const atStation={...snapshot,units:snapshot.units.map(unit=>unit.id===ship.id?posed:unit)};
 expect(outmatchingCoast(snapshot,'player',ship,station,context()).map(unit=>unit.id))
  .toEqual(outmatchingCoast(atStation,'player',posed,posed,context()).map(unit=>unit.id));
});
