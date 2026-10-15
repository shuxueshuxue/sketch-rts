import {expect,it} from 'vitest';
import {sketchScene} from '../../sdk/scene';
import {snapshotGame} from '../../shared/sim';
import {createAiPolicyMemory} from '../memory';
import {assaultExpedition} from './naval';
import {effectiveCombatRating} from './v6/strength';

function scenario() {
 const game=sketchScene('island-expedition').map('bareDuel').replaceDefaults()
  .player('us',{team:'a'}).player('foe',{team:'b'})
  .townHall('us',500,500).townHall('foe',3500,500).build().createGame();
 game.map.terrain={cell:32,cols:128,rows:128,cells:Array.from({length:128*128},(_,i)=>{const x=i%128;return x<32||x>70&&x<92||x>102?'.':'~';}).join('')};
 for(let i=0;i<30;i++)game.spawnUnit('us','footman',500+i*10,800);
 for(let i=0;i<6;i++)game.spawnUnit('foe','footman',3500+i*10,800);
 return game;
}
it('sizes lift for a sufficient invasion instead of the entire world army',()=>{
 const game=scenario(),s=snapshotGame(game),result=assaultExpedition(s,'us',{version:'v9',memory:createAiPolicyMemory()},game.buildings[1]!);
 expect(result.ready).toBe(true);expect(result.crew.length).toBeLessThan(30);
 const power=result.crew.reduce((n,u)=>n+effectiveCombatRating(s,u),0);
 expect(power).toBeGreaterThanOrEqual(result.required);
 expect(power-effectiveCombatRating(s,result.crew.at(-1)!)).toBeLessThan(result.required);
});
it('does not promise troops defending another island or temporary summons',()=>{
 const game=scenario();game.spawnUnit('foe','footman',600,800);
 const summoned=game.spawnUnit('us','golem',2500,800);summoned.expiresTick=500;
 const result=assaultExpedition(snapshotGame(game),'us',{version:'v9',memory:createAiPolicyMemory()},game.buildings[1]!);
 expect(result.ready).toBe(false);expect(result.crew).toHaveLength(0);
});
it('includes troops already landed but never workers as invasion strength',()=>{
 const game=scenario();game.units=game.units.filter(u=>u.owner==='foe');
 for(let i=0;i<30;i++)game.spawnUnit('us','worker',3500,1000+i*10);
 const options={version:'v9' as const,memory:createAiPolicyMemory()},target=game.buildings[1]!;
 expect(assaultExpedition(snapshotGame(game),'us',options,target).ready).toBe(false);
 for(let i=0;i<12;i++)game.spawnUnit('us','footman',3500,1400+i*10);
 const result=assaultExpedition(snapshotGame(game),'us',options,target);
 expect(result.ready).toBe(true);expect(result.crew).toHaveLength(0);
});

it('collects a second island before committing an understrength loaded carrier', async()=>{
 const {boardUnit}=await import('../../shared/decks');
 const {issuePlayerCommand,stepGame,restoreSnapshotIntoGame}=await import('../../shared/sim');
 const {planNavalTactics}=await import('./naval');
 const game=scenario();game.units=game.units.filter(u=>u.owner==='foe');
 const boat=game.spawnUnit('us','carrier',1200,1400);boat.sailing!.heading=Math.PI/2;
 for(let i=0;i<2;i++){const soldier=game.spawnUnit('us','footman',1200,1400);expect(boardUnit(boat,soldier,game.units)).toBe(true);}
 for(let i=0;i<12;i++)game.spawnUnit('us','footman',2500+i*15,1500);
 const memory=createAiPolicyMemory();memory.naval={ferries:{[boat.id]:{purpose:'assault',targetId:game.buildings[1]!.id,
  from:{x:1008,y:1400},to:{x:3280,y:1400},phase:'loading',crewIds:[],sinceTick:0}}};
 const options={version:'v9' as const,memory,teams:game.teams};
 const commands=planNavalTactics(snapshotGame(game),'us',options);
 expect(memory.naval.ferries![boat.id]!.pickup).toBeDefined();
 expect(commands.some(c=>c.type==='unload' && c.unitIds.includes(boat.id))).toBe(false);
 for(const c of commands)issuePlayerCommand(game,'us',c);
 let loaded=2;let checkpoint: {snapshot:ReturnType<typeof snapshotGame>;nextId:number;memory:typeof memory}|undefined;
 for(let tick=0;tick<6000;tick++){
  if(tick%15===0)for(const c of planNavalTactics(snapshotGame(game),'us',options))issuePlayerCommand(game,'us',c);
  stepGame(game);
  if(game.tick===600)checkpoint={snapshot:snapshotGame(game),nextId:game.nextId,memory:structuredClone(memory)};
  loaded=Math.max(loaded,game.units.filter(u=>u.deck?.shipId===boat.id).length);
  if(loaded>=10)break;
 }
 expect(loaded,JSON.stringify({boat,mission:memory.naval.ferries![boat.id]})).toBeGreaterThanOrEqual(10);
 expect(game.units.filter(unit=>unit.owner==='us').every(unit=>unit.hp===unit.maxHp)).toBe(true);
 expect(checkpoint).toBeDefined();
 const resumed=scenario();restoreSnapshotIntoGame(resumed,checkpoint!.snapshot,checkpoint!.nextId);
 const resumedOptions={...options,memory:checkpoint!.memory};
 while(resumed.tick<game.tick){
  if(resumed.tick%15===0)for(const command of planNavalTactics(snapshotGame(resumed),'us',resumedOptions))issuePlayerCommand(resumed,'us',command);
  stepGame(resumed);
 }
 expect(snapshotGame(resumed)).toEqual(snapshotGame(game));
 expect(resumed.nextId).toBe(game.nextId);
 expect(resumedOptions.memory).toEqual(memory);
},60000);
