import {expect,it} from 'vitest';
import {sketchScene} from '../../sdk/scene';
import type {TrainableUnitKind} from '../../shared/types';
import {colonyNavalWant,navalBudgetReserve,planNavalEconomy} from '../policy/naval';
import {boardUnit} from '../../shared/decks';
import {snapshotGame} from '../../shared/sim';
import {createAiPolicyMemory} from '../memory';
import {readV6Intel} from '../policy/v6/intel';
import {BOOTSTRAP_DOCTRINES,bootstrapPolicyContext} from './policy';
import {rankBootstrapGoals} from './economy';

it.each((['v9_archer','v9_summoner','v9_knight'] as const).flatMap(version=>(['grove','ember'] as const).map(race=>({version,race}))))(
 '$version/$race counts embarked opening recruits without counting them as local combat cover',({version,race})=>{
  const doctrine=BOOTSTRAP_DOCTRINES[version].find(d=>d.race===race)!;
  const targets=new Map<TrainableUnitKind,number>();
  for(const want of doctrine.phases[0]!.wants)if('unit' in want)targets.set(want.unit,Math.max(targets.get(want.unit)??0,want.count));
  let scene=sketchScene('embarked-opening').replaceDefaults().player('us',{race,team:'a'}).player('foe',{team:'b'})
   .townHall('us',500,500).goldMine('a',788,500,6000)
   .townHall('us',1500,500).goldMine('b',1788,500,6000).townHall('foe',3500,3500)
   .unit('us','carrier',2500,2000,{id:'boat'}).farms('us',4,500,1200);
  for(const [kind,count] of targets)for(let i=0;i<count;i++)scene=scene.unit('us',kind,2400+i*25,2100,{id:`recruit-${kind}-${i}`});
  const game=scene.build().createGame(),boat=game.units.find(u=>u.id==='boat')!;
  for(const unit of game.units.filter(u=>u.id.startsWith('recruit-')))expect(boardUnit(boat,unit,game.units)).toBe(true);
  const memory=createAiPolicyMemory();memory.v6={phase:0,doctrine:{strategyId:doctrine.id,profileId:'warlord',decidedTick:0}};
  const snapshot=snapshotGame(game),options=bootstrapPolicyContext(snapshot,'us',version,{memory,teams:game.teams});
  expect(readV6Intel(snapshot,'us',options).army).toHaveLength(0);
  rankBootstrapGoals(snapshot,'us',options);
  expect(memory.v6!.phase).toBeGreaterThan(0);
 });

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s builds a beachhead garrison only on a contested landmass',version=>{
 const game=sketchScene('contested-colony').map('bareDuel').replaceDefaults()
  .player('us',{team:'a'}).player('foe',{team:'b'})
  .townHall('us',500,500).townHall('us',2500,500).townHall('foe',3500,500)
  .worker('us',2600,650).goldMine('home',788,500,6000).goldMine('colony',2788,500,6000).build().createGame();
 game.map.terrain={cell:32,cols:128,rows:128,cells:Array.from({length:128*128},(_,i)=>{const col=i%128;return col<32||col>70&&col<92||col>102?'.':'~';}).join('')};
 const want=()=>{const s=snapshotGame(game);return colonyNavalWant(s,'us',bootstrapPolicyContext(s,'us',version,{memory:createAiPolicyMemory(),teams:game.teams}))?.id;};
 expect(want()?.startsWith('naval:foothold')).not.toBe(true);
 game.spawnUnit('foe','footman',2600,850);
 expect(want()).toBe('naval:footholdProducer');
});

it('funds coast defense before land garrisons when enemy guns reach a colony',()=>{
 const game=sketchScene('coastal-colony').map('bareDuel').replaceDefaults()
  .player('us',{team:'a'}).player('foe',{team:'b'})
  .townHall('us',500,500).townHall('us',2500,500).townHall('foe',3500,500)
  .worker('us',2600,650).goldMine('home',788,500,0).goldMine('colony',2788,500,1000)
  .goldMine('remote',3500,800,6000).build().createGame();
 game.map.terrain={cell:32,cols:128,rows:128,cells:Array.from({length:128*128},(_,i)=>{const x=i%128;return x<32||x>70&&x<92||x>102?'.':'~';}).join('')};
 const options=()=>bootstrapPolicyContext(snapshotGame(game),'us','v9_archer',{memory:createAiPolicyMemory(),teams:game.teams});
 expect(navalBudgetReserve(snapshotGame(game),'us',options())).toBeGreaterThan(0);
 game.spawnUnit('foe','warship',2100,500);
 expect(navalBudgetReserve(snapshotGame(game),'us',options())).toBeGreaterThan(0);
 expect(planNavalEconomy(snapshotGame(game),'us',options())).toMatchObject({type:'build',buildingKind:'defenseTower'});
 expect(colonyNavalWant(snapshotGame(game),'us',options())?.id).toBe('naval:footholdTower');
});

it('prepares a targeted colony while an armed enemy convoy is still at sea',()=>{
 const game=sketchScene('incoming-colony-landing').map('bareDuel').replaceDefaults()
  .player('us',{team:'a'}).player('foe',{team:'b'})
  .townHall('us',500,500).townHall('us',2500,500).townHall('foe',3500,500)
  .worker('us',2600,650).goldMine('colony',2788,500,1000).goldMine('remote',3500,800,6000)
  .unit('foe','transport',1500,500,{id:'convoy'}).unit('foe','archer',1550,500,{id:'raider'})
  .build().createGame();
 game.map.terrain={cell:32,cols:128,rows:128,cells:Array.from({length:128*128},(_,i)=>{const x=i%128;return x<32||x>70&&x<92||x>102?'.':'~';}).join('')};
 const ship=game.units.find(u=>u.id==='convoy')!,raider=game.units.find(u=>u.id==='raider')!;
 expect(boardUnit(ship,raider,game.units)).toBe(true);
 const check=()=>{const s=snapshotGame(game),o=bootstrapPolicyContext(s,'us','v9_archer',{memory:createAiPolicyMemory(),teams:game.teams});return {reserve:navalBudgetReserve(s,'us',o),want:colonyNavalWant(s,'us',o)?.id};};
 expect(check().want?.startsWith('naval:foothold')).not.toBe(true);
 ship.order={type:'unload',x:2400,y:500};
 expect(check().reserve).toBeGreaterThan(0);
 expect(check().want).toBe('naval:footholdProducer');
 const s=snapshotGame(game),o=bootstrapPolicyContext(s,'us','v9_archer',{memory:createAiPolicyMemory(),teams:game.teams});
 expect(planNavalEconomy(s,'us',o)).toMatchObject({type:'build',buildingKind:'barracks'});
 ship.order={type:'unload',x:3500,y:500};
 expect(check().want?.startsWith('naval:foothold')).not.toBe(true);
});
