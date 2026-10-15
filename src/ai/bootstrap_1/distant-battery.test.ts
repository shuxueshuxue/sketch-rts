import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame,issuePlayerCommand,stepGame} from '../../shared/sim';
import {hullFits} from '../../shared/ship-navigation';
import {outmatchingCoast} from '../policy/coastal-risk';
import {coastalBatteryWaypoint,coastalBombardment} from '../policy/coastal-bombardment';
import {coastalVoyagePrefixSafe} from '../policy/coastal-voyage';
import {planNavalTactics} from '../policy/naval';
import {createAiPolicyMemory} from '../memory';
import {planBootstrapNaval} from './expedition-recovery';
import {bootstrapPolicyContext} from './policy';

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s sends the idle battery toward an exposed firing station instead of a covered landing',version=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/summoner-distant-battery.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const s=snapshotGame(game),ship=s.units.find(u=>u.id==='unit-p0-bombardShip-26580')!;
 const options=bootstrapPolicyContext(s,'p0',version,{memory:structuredClone(saved.memory),teams:game.teams});
 const commands=planNavalTactics(s,'p0',options),order=commands.find(c=>c.type==='move'&&c.unitIds.includes(ship.id));
 expect(order).toBeDefined();
 const targetId=options.memory.naval!.combat![ship.id]!.targetId;
 const target=s.buildings.find(b=>b.id===targetId)!;expect(target.owner).toBe('p1');
 const plan=coastalBombardment(s,ship,[target],options)!;
 expect(hullFits(s.map,ship,plan)).toBe(true);
 expect(outmatchingCoast(s,'p0',ship,plan,options)).toEqual([]);
 const waypoint=options.memory.naval!.coastalVoyages![ship.id]!.waypoint;
 expect(order).toEqual({type:'move',unitIds:[ship.id],...waypoint,avoidCombat:true});
 const covered=s.buildings.find(b=>b.id==='building-p1-shipyard-1016')!;
 expect(coastalBombardment(s,ship,[covered],options)).toBeUndefined();
 expect(coastalBombardment(s,ship,[],options)).toBeUndefined();
});

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s retains a real coastal battery voyage when the rest of the fleet reassembles',version=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/summoner-battery-muster.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const s=snapshotGame(game),id='unit-p0-bombardShip-26580',ship=s.units.find(u=>u.id===id)!;
 const options=bootstrapPolicyContext(s,'p0',version,{memory:structuredClone(saved.memory),teams:game.teams});
 const station=coastalBombardment(s,ship,s.buildings.filter(b=>b.owner==='p1'),options)!;
 const targetId=station.target.id;
 const commands=planNavalTactics(s,'p0',options);
 expect(options.memory.naval!.combat![id]!.targetId).toBe(targetId);
 const waypoint=options.memory.naval!.coastalVoyages![id]!.waypoint;
 expect(commands.find(c=>'unitIds' in c && c.unitIds.includes(id))).toEqual({type:'move',unitIds:[id],...waypoint,avoidCombat:true});
 expect(commands.some(c=>c.type==='attackMove'&&c.unitIds.includes(id))).toBe(false);
});

it('keeps a real detour through native travel and serialized policy memory',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/summoner-battery-transit.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const id='unit-p0-bombardShip-26580',ship=game.units.find(u=>u.id===id)!;
 let memory=createAiPolicyMemory();
 const first=snapshotGame(game),options=bootstrapPolicyContext(first,'p0','v9_summoner',{memory,teams:game.teams});
 const commands=planBootstrapNaval(first,'p0',options);
 const voyage=structuredClone(memory.naval!.coastalVoyages![id]!);
 expect(voyage.waypoint).not.toEqual(voyage.goal);
 const order=commands.find(c=>c.type==='move'&&c.unitIds.includes(id))!;
 expect(order).toEqual({type:'move',unitIds:[id],...voyage.waypoint,avoidCombat:true});
 issuePlayerCommand(game,'p0',order);
 const start={x:ship.x,y:ship.y};
 for(let i=0;i<90;i++)stepGame(game);
 expect(Math.hypot(ship.x-start.x,ship.y-start.y)).toBeGreaterThan(20);
 expect(ship.hp).toBe(ship.maxHp);
 memory=JSON.parse(JSON.stringify(memory));
 const snapshot=snapshotGame(game),restored=bootstrapPolicyContext(snapshot,'p0','v9_summoner',{memory,teams:game.teams});
 const next=planBootstrapNaval(snapshot,'p0',restored);
 expect(memory.naval!.coastalVoyages![id]).toEqual(voyage);
 expect(next.some(c=>c.type==='attackMove'&&c.unitIds.includes(id))).toBe(false);
 expect(next.some(c=>c.type==='move'&&c.unitIds.includes(id))).toBe(false);
},120000);

it('replaces the actual unsafe post-departure corridor with stop and an ordinary safe detour',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/summoner-battery-unsafe-departure.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const s=snapshotGame(game),id='unit-p0-bombardShip-26580',ship=s.units.find(u=>u.id===id)!;
 expect(s.tick).toBe(161311);
 const memory=createAiPolicyMemory(),options=bootstrapPolicyContext(s,'p0','v9_summoner',{memory,teams:game.teams});
 expect(coastalVoyagePrefixSafe(s,ship,ship.sailing!.route,options)).toBe(false);
 const commands=planBootstrapNaval(s,'p0',options).filter(c=>'unitIds'in c && c.unitIds.includes(id));
 expect(commands[0]).toEqual({type:'stop',unitIds:[id]});
 const voyage=memory.naval!.coastalVoyages![id]!;
 expect(voyage.proof).toBe('complete');
 expect(voyage.waypoint).not.toEqual(voyage.goal);
 expect(commands[1]).toEqual({type:'move',unitIds:[id],...voyage.waypoint,avoidCombat:true});
});
