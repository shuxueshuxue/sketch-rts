import {describe,it,expect} from 'vitest';
import {TideboundCampaign, HERO, PLAYER, SHIPS, SIEGE, DEFENSES} from './campaign';
import {isWalkable,sameGround} from '../../shared/terrain';
import {HOME,LANDING,tideboundMap,CITADEL} from './world';
import {issuePlayerCommand} from '../../shared/sim';
import {UNIT_DEFS} from '../../shared/catalog';
describe('Tidal Throne campaign contracts',()=>{
 it('separates rear bases and the front with navigable sea channels',()=>{
  const map=tideboundMap();expect(map.width*map.height).toBe(8192*8192*6.75);
  expect(sameGround(map,HOME,LANDING,'land')).toBe(false);
  expect(sameGround(map,{x:7000,y:7600},{x:9000,y:6400},'sea')).toBe(true);
 });
 it('does not let the main armies finish the opening mission for the player',()=>{
  const c=new TideboundCampaign();for(let i=0;i<660;i++)c.step();
  expect(c.state.mission.stage).toBe(0);expect(c.state.mission.convoySpawned).toBe(false);
 });
 it('keeps an embarked hero alive and clears reservations from sunk transports',()=>{
  const c=new TideboundCampaign(),hero=c.game.units.find(u=>u.id===HERO)!,boat=c.game.units.find(u=>u.owner===PLAYER&&u.kind==='transport')!;
  boat.cargo=[hero];c.game.units=c.game.units.filter(u=>u!==hero);
  c.state.voyages['sunk-transport']={target:'north',stage:'loading',since:0,crew:['test']};
  for(let i=0;i<100;i++)c.step();
  expect(c.state.outcome).toBe('playing');expect(c.state.voyages['sunk-transport']).toBeUndefined();
 });
 it('blocks actual attacks on the citadel until the seal is destroyed',()=>{
  const c=new TideboundCampaign(),citadel=c.game.buildings.find(b=>b.id==='citadel')!;
  c.game.units=c.game.units.filter(u=>u.owner===PLAYER);
  const archer=c.game.spawnUnit(PLAYER,'archer',CITADEL.x-300,CITADEL.y);archer.attackRange=1000;archer.attackDamage=300;
  c.state.mission.stage=3;
  issuePlayerCommand(c.game,PLAYER,{type:'attack',unitIds:[archer.id],targetId:citadel.id});
  for(let i=0;i<20;i++)c.step();expect(citadel.hp).toBe(18000);
  c.game.buildings=c.game.buildings.filter(b=>b.id!=='tide-seal');
  for(let i=0;i<80;i++)c.step();
  expect(c.state.mission.sealBroken).toBe(true);expect(citadel.hp).toBeLessThan(18000);
 });
 it('starts with real armies, all battlefield roles and valid ground',()=>{
  const c=new TideboundCampaign();expect(c.game.units.length).toBeGreaterThanOrEqual(5000);
  for(const d of [...SHIPS,...SIEGE])expect(c.game.units.some(u=>u.variant===`tide/${d.id}`)).toBe(true);
  for(const d of DEFENSES)expect(Object.values(c.state.defense)).toContain(d.id);
  for(const u of c.game.units)expect(isWalkable(c.game.map,u.x,u.y,UNIT_DEFS[u.kind].naval?'sea':'land'),u.id).toBe(true);
 });
 it('queues production, refunds cancellation and rejects unaffordable requests',()=>{
  const c=new TideboundCampaign(),gold=c.game.players[PLAYER]!.gold;
  expect(c.recruit('ballista')).toBeUndefined();expect(c.state.jobs).toHaveLength(1);
  c.cancelRecruit(c.state.jobs[0]!.id);expect(c.game.players[PLAYER]!.gold).toBe(gold);expect(c.state.jobs).toHaveLength(0);
  c.game.players[PLAYER]!.supplyCap=0;expect(c.recruit('ballista')).toContain('人口不足');
  c.game.players[PLAYER]!.gold=0;expect(c.recruit('frigate')).toBe('黄金不足');
 });
 it('keeps custom construction non-targetable until the engineer arrives',()=>{
  const c=new TideboundCampaign(),w=c.game.units.find(u=>u.owner===PLAYER&&u.kind==='worker')!;
  const before=c.game.buildings.length,gold=c.game.players[PLAYER]!.gold;
  expect(c.fortify('watch',w.x+200,w.y-100)).toBeUndefined();expect(c.game.buildings).toHaveLength(before);expect(c.game.players[PLAYER]!.gold).toBe(gold);
  c.command({type:'stop',unitIds:[w.id]});for(let i=0;i<20;i++)c.step();expect(c.state.plans).toHaveLength(0);expect(c.game.buildings).toHaveLength(before);
 });
 it('rejects out-of-range relic use and prevents cooldown bypass',()=>{
  const c=new TideboundCampaign(),h=c.game.units.find(u=>u.id===HERO)!;
  expect(c.cast(0,8000,8000)).toBe('目标超出遗物射程');expect(c.state.cooldowns[0]).toBe(0);
  expect(c.cast(0,h.x,h.y)).toBeUndefined();expect(c.cast(0,h.x,h.y)).toBe('遗物尚在冷却');
 });
 it('holds evacuated units so a retreat does not immediately re-engage',()=>{
  const c=new TideboundCampaign(),h=c.game.units.find(u=>u.id===HERO)!;
  expect(c.cast(5,h.x-200,h.y)).toBeUndefined();expect(h.order.type).toBe('hold');
 });
 it('restores full deterministic state and then advances identically',()=>{
  const c=new TideboundCampaign();for(let i=0;i<25;i++)c.step();
  const d=new TideboundCampaign('standard',JSON.parse(JSON.stringify(c.save())));
  for(let i=0;i<25;i++){c.step();d.step();}
  expect(JSON.parse(JSON.stringify(d.save()))).toEqual(JSON.parse(JSON.stringify(c.save())));
 });
 it('loads earlier campaign saves after optional systems are added',()=>{
  const c=new TideboundCampaign(),save=JSON.parse(JSON.stringify(c.save()));
  delete save.state.jobs;delete save.state.plans;delete save.state.voyages;
  const loaded=new TideboundCampaign('standard',save);for(let i=0;i<20;i++)loaded.step();
  expect(loaded.state.jobs).toEqual([]);expect(loaded.state.plans).toEqual([]);
 });

});
