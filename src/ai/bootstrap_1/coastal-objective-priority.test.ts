import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {shoreFiringStation} from '../../shared/shore-fire';
import {combatCapability} from '../../shared/combat-capabilities';
import {shipPassengers} from '../../shared/ship-geometry';
import {boardUnit} from '../../shared/decks';
import {coastalBatteryWaypoint,coastalBombardment} from '../policy/coastal-bombardment';
import {coastalVoyagePrefixSafe} from '../policy/coastal-voyage';
import type {BootstrapAiVersion,GameCommand} from '../../shared/types';
import {planBootstrapNaval} from './expedition-recovery';
import {bootstrapPolicyContext} from './policy';

const id='unit-p0-bombardShip-26580';
function observed(name:string,version:BootstrapAiVersion='v9_summoner'){
 const saved=JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`,import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const snapshot=snapshotGame(game),ship=snapshot.units.find(u=>u.id===id)!;
 const options=bootstrapPolicyContext(snapshot,'p0',version,{memory:structuredClone(saved.memory),teams:game.teams});
 return {game,snapshot,ship,options};
}
function forBattery(commands:GameCommand[]){return commands.filter(c=>'unitIds'in c&&c.unitIds.includes(id));}

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s continues past the real empty transport instead of holding on an unrelated coast threat',version=>{
 const {snapshot,ship,options}=observed('coastal-empty-transport',version);
 expect(snapshot.tick).toBe(165000);
 const boat=snapshot.units.find(u=>u.id==='unit-p1-transport-1487')!;
 expect(combatCapability(snapshot,boat).armed).toBe(false);
 expect(boat.order.type).toBe('idle');
 expect(shipPassengers(snapshot.units,boat)).toEqual([]);
 expect(Math.hypot(boat.x-ship.x,boat.y-ship.y)).toBeLessThan(900);
 const station=shoreFiringStation(snapshot,ship,boat)!;
 expect(Math.hypot(station.x-ship.x,station.y-ship.y)).toBeGreaterThan(200);
 const commands=forBattery(planBootstrapNaval(snapshot,'p0',options));
 expect(commands.some(c=>c.type==='move'&&c.avoidCombat)).toBe(true);
 expect(commands.some(c=>c.type==='holdPosition'||c.type==='attackMove')).toBe(false);
 const targetId=options.memory.naval!.combat![id]!.targetId;
 expect(snapshot.buildings.some(b=>b.id===targetId&&b.owner==='p1')).toBe(true);
});

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s keeps the observed safe voyage when a distant shore unit enters local acquisition',version=>{
 const {snapshot,ship,options}=observed('coastal-local-acquisition',version);
 expect(snapshot.tick).toBe(164880);
 const nearby=snapshot.units.find(u=>u.id==='unit-p1-sparkArcher-1181')!;
 expect(Math.hypot(nearby.x-ship.x,nearby.y-ship.y)).toBeLessThan(900);
 expect(snapshot.units.some(u=>u.owner==='p1'&&'targetId'in u.order&&u.order.targetId===id)).toBe(false);
 const firing=shoreFiringStation(snapshot,ship,nearby)!;
 expect(Math.hypot(firing.x-ship.x,firing.y-ship.y)).toBeGreaterThan(200);
 expect(coastalVoyagePrefixSafe(snapshot,ship,ship.sailing!.route,options)).toBe(true);
 const voyage=structuredClone(options.memory.naval!.coastalVoyages![id]!);
 const commands=forBattery(planBootstrapNaval(snapshot,'p0',options));
 expect(commands).toEqual([]);
 expect(options.memory.naval!.combat![id]!.targetId).toBe(voyage.targetId);
 expect(options.memory.naval!.coastalVoyages![id]).toEqual(voyage);
 expect(ship.order).toMatchObject({type:'move',...voyage.waypoint,avoidCombat:true});
});

it('keeps the actual escape under live enemy fire instead of holding for the coastal objective',()=>{
 const {snapshot,ship,options}=observed('coastal-live-retreat');
 expect(snapshot.tick).toBe(165600);
 expect(snapshot.units.filter(u=>u.owner==='p1'&&'targetId'in u.order&&u.order.targetId===id).length).toBeGreaterThan(10);
 const retreat=structuredClone(options.memory.naval!.coastalRetreat![id]);
 expect(ship.order).toMatchObject({type:'move',...retreat,avoidCombat:true});
 expect(forBattery(planBootstrapNaval(snapshot,'p0',options))).toEqual([]);
 expect(options.memory.naval!.coastalRetreat![id]).toEqual(retreat);
});

it('retains the real locally fireable enemy engagement instead of forcing the remote coastal mission',()=>{
 const {snapshot,ship,options}=observed('coastal-in-place-fire');
 expect(snapshot.tick).toBe(168000);
 const target=snapshot.units.find(u=>u.id==='unit-p1-sparkArcher-2823')!;
 const firing=shoreFiringStation(snapshot,ship,target)!;
 expect(Math.hypot(firing.x-ship.x,firing.y-ship.y)).toBeLessThan(1e-6);
 expect(ship.order).toMatchObject({type:'attackMove',targetId:target.id});
 const commands=forBattery(planBootstrapNaval(snapshot,'p0',options));
 expect(commands).toEqual([]);
 expect(options.memory.naval!.combat![id]!.targetId).toBe(target.id);
});

it('still responds to an explicit attack on our force outside current firing reach',()=>{
 const {snapshot,ship,options}=observed('coastal-local-acquisition');
 const foe=snapshot.units.find(u=>u.id==='unit-p1-sparkArcher-1181')!;
 // Counterfactual order only: the original distant ship/army positions and
 // all resources stay intact. The real live-fire/escape frame is above.
 foe.order={type:'attack',targetId:id};
 expect(Math.hypot(shoreFiringStation(snapshot,ship,foe)!.x-ship.x,shoreFiringStation(snapshot,ship,foe)!.y-ship.y)).toBeGreaterThan(200);
 expect(forBattery(planBootstrapNaval(snapshot,'p0',options))).toContainEqual({type:'attackMove',unitIds:[id],x:foe.x,y:foe.y});
 expect(options.memory.naval!.combat![id]!.targetId).toBe(foe.id);
});

it('keeps an armed enemy ship as a threat outside current firing reach',()=>{
 const {game,options}=observed('coastal-empty-transport');
 const old=game.units.find(u=>u.id==='unit-p1-transport-1487')!;
 // Counterfactual enemy hull, at the observed enemy water position.
 game.units=game.units.filter(u=>u.id!==old.id);
 const enemy=game.spawnUnit('p1','warship',old.x,old.y);
 const snapshot=snapshotGame(game),context=bootstrapPolicyContext(snapshot,'p0','v9_summoner',{memory:options.memory,teams:game.teams});
 expect(combatCapability(snapshot,enemy).armed).toBe(true);
 planBootstrapNaval(snapshot,'p0',context);
 expect(context.memory.naval!.combat![id]!.targetId).toBe(enemy.id);
});

it('keeps a transport with armed passengers explicitly landing on our island as a defensive target',()=>{
 const {game,options}=observed('coastal-empty-transport');
 const boat=game.units.find(u=>u.id==='unit-p1-transport-1487')!;
 const hall=game.buildings.find(b=>b.owner==='p0'&&b.kind==='townHall')!;
 // Counterfactual embarkation and intent isolate a real invasion from the
 // original fixture's verified empty, idle transport.
 const soldier=game.spawnUnit('p1','sparkArcher',boat.x,boat.y);
 expect(boardUnit(boat,soldier,game.units)).toBe(true);
 boat.order={type:'unload',x:hall.x,y:hall.y};
 const snapshot=snapshotGame(game),context=bootstrapPolicyContext(snapshot,'p0','v9_summoner',{memory:options.memory,teams:game.teams});
 expect(shipPassengers(snapshot.units,boat)).toHaveLength(1);
 expect(combatCapability(snapshot,boat).armed).toBe(false);
 planBootstrapNaval(snapshot,'p0',context);
 expect(context.memory.naval!.combat![id]!.targetId).toBe(boat.id);
});

it('keeps the original voyage proof when a later native route is complete',()=>{
 const {snapshot,ship,options}=observed('coastal-local-acquisition');
 const current=options.memory.naval!.coastalVoyages![id]!;
 current.proof='prefix';
 expect(ship.sailing!.route!.partial).toBe(false);
 const target=snapshot.buildings.find(b=>b.id===current.targetId)!;
 const plan=coastalBombardment(snapshot,ship,[target],options)!;
 expect(coastalBatteryWaypoint(snapshot,ship,plan,options)).toEqual(current.waypoint);
 expect(current.proof).toBe('prefix');
});
