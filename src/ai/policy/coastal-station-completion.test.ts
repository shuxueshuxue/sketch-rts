import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import type {AiPolicyMemory} from '../memory';
import type {BootstrapAiVersion,GameSnapshot} from '../../shared/types';
import {setBuildingBodies} from '../../shared/terrain';
import {beginShipCollisionFrame} from '../../shared/ship-collisions';
import {workingWeaponGeometry} from '../../shared/combat-fire-geometry';
import {localToWorld} from '../../shared/ship-geometry';
import {shoreFiringStation} from '../../shared/shore-fire';
import {bootstrapPolicyContext} from '../bootstrap_1/policy';
import {planBootstrapNaval} from '../bootstrap_1/expedition-recovery';
import {coastalBatteryMovePending} from './coastal-bombardment';

const id='unit-p0-bombardShip-50739';
function actual(version:BootstrapAiVersion){
  const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-station-incomplete-267135.json.gz',import.meta.url))).toString()) as {
    snapshot:GameSnapshot;nextId:number;memories:Record<string,AiPolicyMemory>;
  };
  const snapshot=saved.snapshot;
  setBuildingBodies(snapshot.map,[...snapshot.buildings,...(snapshot.obstacles??[])]);
  beginShipCollisionFrame(snapshot.units,snapshot.map,[...snapshot.buildings,...(snapshot.obstacles??[])]);
  const options=bootstrapPolicyContext(snapshot,'p0',version,{memory:structuredClone(saved.memories.p0!)});
  return {saved,snapshot,options,ship:snapshot.units.find(unit=>unit.id===id)!};
}

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s finishes the actual ordinary firing-station leg inside the combat radius',version=>{
  const {saved,snapshot,options,ship}=actual(version);
  const voyage=structuredClone(options.memory.naval!.coastalVoyages![id]!);
  const target=snapshot.buildings.find(building=>building.id===voyage.targetId)!;
  expect(snapshot.tick).toBe(267135);
  expect(ship.order).toMatchObject({type:'move',...voyage.waypoint,avoidCombat:true});
  expect(ship.sailing!.route).toMatchObject({partial:false,goalX:voyage.waypoint.x,goalY:voyage.waypoint.y});
  expect(ship.sailing!.route!.points).toHaveLength(1);
  expect(ship.arrivedAt).not.toEqual(voyage.waypoint);
  expect(Math.hypot(ship.x-voyage.waypoint.x,ship.y-voyage.waypoint.y)).toBeGreaterThan(60);
  expect(Math.hypot(ship.x-voyage.waypoint.x,ship.y-voyage.waypoint.y)).toBeLessThan(70);
  expect(workingWeaponGeometry(snapshot,ship,target).some(weapon=>weapon.covers)).toBe(false);
  const before=JSON.stringify(saved),commands=planBootstrapNaval(snapshot,'p0',options);
  expect(commands.filter(command=>'unitIds' in command&&command.unitIds.includes(id))).toEqual([]);
  expect(options.memory.naval!.coastalVoyages![id]).toEqual(voyage);
  expect(JSON.stringify(saved)).toBe(before);
});

it('keeps the same published leg when the same target is admitted from the current position',()=>{
  const {ship,snapshot,options}=actual('v9_summoner');
  const voyage=options.memory.naval!.coastalVoyages![id]!;
  const target=snapshot.buildings.find(building=>building.id===voyage.targetId)!;
  // Counterfactual plan coordinate only: shoreFiringStation can return the
  // current position when turning there would allow a shot. This does not
  // assert that this fixture's actual current position can fire.
  expect(coastalBatteryMovePending(ship,{x:ship.x,y:ship.y,heading:ship.sailing!.heading,target},options)).toBe(true);
});

it('keeps the actual owner when the same selected target becomes locally fireable before native arrival',()=>{
  const {ship,snapshot,options}=actual('v9_summoner');
  const voyage=structuredClone(options.memory.naval!.coastalVoyages![id]!);
  const target=snapshot.buildings.find(building=>building.id===voyage.targetId)!;
  // Counterfactual physical pose just inside the original range-boundary
  // station, with the existing public move and final point still pending.
  // Synchronize its real deck occupants rather than teleporting the hull
  // independently of crew. This is an owner contract, not a played result.
  const dx=target.x-voyage.goal.x,dy=target.y-voyage.goal.y,length=Math.hypot(dx,dy);
  ship.x=voyage.goal.x+dx/length*2;ship.y=voyage.goal.y+dy/length*2;
  for(const crew of snapshot.units.filter(unit=>unit.deck?.shipId===id)){
    const point=localToWorld(ship,crew.deck!);crew.x=point.x;crew.y=point.y;
  }
  const current=shoreFiringStation(snapshot,ship,target)!;
  expect(Math.hypot(current.x-ship.x,current.y-ship.y)).toBeLessThan(1e-5);
  const before=JSON.stringify(snapshot),commands=planBootstrapNaval(snapshot,'p0',options);
  expect(options.memory.naval!.combat![id]!.targetId).toBe(target.id);
  expect(commands.filter(command=>'unitIds' in command&&command.unitIds.includes(id))).toEqual([]);
  expect(options.memory.naval!.coastalVoyages![id]).toEqual(voyage);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('releases the old leg when the selected target changes',()=>{
  const {ship,snapshot,options}=actual('v9_summoner');
  const voyage=options.memory.naval!.coastalVoyages![id]!;
  const target=snapshot.buildings.find(building=>building.id==='building-p2-farm-1409')!;
  expect(coastalBatteryMovePending(ship,{...voyage.goal,heading:0,target},options)).toBe(false);
});

it('releases the old leg after another public order takes the hull',()=>{
  const {ship,snapshot,options}=actual('v9_summoner');
  const voyage=options.memory.naval!.coastalVoyages![id]!;
  const target=snapshot.buildings.find(building=>building.id===voyage.targetId)!;
  ship.order={type:'hold',x:ship.x,y:ship.y};
  expect(coastalBatteryMovePending(ship,{...voyage.goal,heading:0,target},options)).toBe(false);
});

it('does not claim a different native coordinate move as its published waypoint',()=>{
  const {ship,snapshot,options}=actual('v9_summoner');
  const voyage=options.memory.naval!.coastalVoyages![id]!;
  const target=snapshot.buildings.find(building=>building.id===voyage.targetId)!;
  ship.order={type:'move',x:ship.x,y:ship.y,avoidCombat:true};
  expect(coastalBatteryMovePending(ship,{...voyage.goal,heading:0,target},options)).toBe(false);
});

it('leaves a native idle/completed move released rather than treating memory as pending forever',()=>{
  const {ship,snapshot,options}=actual('v9_summoner');
  const voyage=options.memory.naval!.coastalVoyages![id]!;
  const target=snapshot.buildings.find(building=>building.id===voyage.targetId)!;
  // Counterfactual native terminal state, with the real route endpoint. The
  // owner does not equate current coordinates with a completion proof.
  const end=ship.sailing!.route!.end!;
  ship.x=end.x;ship.y=end.y;ship.order={type:'idle'};
  ship.arrivedAt={...voyage.waypoint};ship.sailing!.route!.points=[];
  expect(coastalBatteryMovePending(ship,{...voyage.goal,heading:0,target},options)).toBe(false);
});
