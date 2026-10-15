import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { BUILDING_DEFS } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapEconomy } from './economy';

it.each((['v9_archer','v9_summoner','v9_knight'] as const).flatMap(version=>[false,true].map(mirror=>({version,mirror}))))(
  '$version builds supply at a staffed colony after the last home worker leaves (mirror=$mirror)',({version,mirror})=>{
    const x=(value:number)=>mirror?4096-value:value;
    let scene=sketchScene('staffed-colony-supply').map('bareDuel').replaceDefaults()
      .player('us',{race:'grove',team:'a'}).player('foe',{team:'b'})
      .townHall('us',x(500),500).townHall('us',x(3000),500).townHall('foe',x(500),3500)
      .building('us','barracks',x(3000),800).farms('us',4,x(500),1500)
      .worker('us',x(3200),650,{id:'settler'});
    for(let i=0;i<20;i++)scene=scene.unit('us','footman',x(3000+i%5*40),1100+Math.floor(i/5)*40);
    const game=scene.build().createGame();game.scriptedVictory=true;
    game.map.terrain={cell:32,cols:128,rows:128,cells:Array.from({length:128*128},(_,i)=>{
      const col=mirror?127-i%128:i%128;return col<40||col>75?'.':'~';
    }).join('')};
    for(const building of game.buildings)Object.assign(building,snapToFootprint(game.map,building.radius,building));
    setBuildingBodies(game.map,game.buildings);
    const snapshot=snapshotGame(game),worker=game.units.find(unit=>unit.id==='settler')!;
    expect(sameGround(game.map,worker,game.buildings[0]!)).toBe(false);
    const options=bootstrapPolicyContext(snapshot,'us',version,{memory:createAiPolicyMemory(),teams:game.teams});
    const command=planBootstrapEconomy(snapshot,'us',options).find(command=>command.type==='build'&&command.buildingKind==='farm');
    expect(command).toMatchObject({type:'build',unitId:'settler',buildingKind:'farm'});
    if(command?.type!=='build')throw new Error('missing colony supply command');
    expect(sameGround(game.map,worker,command)).toBe(true);
    const gold=game.players.us!.gold,cap=game.players.us!.supplyCap;
    issuePlayerCommand(game,'us',command);
    for(let i=0;i<1000;i++)stepGame(game);
    expect(game.buildings.filter(building=>building.owner==='us'&&building.kind==='farm'&&building.complete)).toHaveLength(5);
    expect(game.players.us!.supplyCap).toBe(cap+BUILDING_DEFS.farm.supplyProvided);
    expect(gold-game.players.us!.gold).toBe(BUILDING_DEFS.farm.cost);
    expect(game.match.stats.unitsLost.us).toBe(0);
  });
