import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import type {AiPolicyMemory} from '../memory';
import type {BootstrapAiVersion,GameSnapshot} from '../../shared/types';
import {setBuildingBodies} from '../../shared/terrain';
import {beginShipCollisionFrame} from '../../shared/ship-collisions';
import {bootstrapPolicyContext} from '../bootstrap_1/policy';
import {planBootstrapNaval} from '../bootstrap_1/expedition-recovery';
import {fleetAttackCommand} from './fleet-engagement';

const id='unit-p0-bombardShip-50739',targetId='building-p2-farm-4745';
function actual(version:BootstrapAiVersion='v9_summoner'){
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-battery-arrived-267300.json.gz',import.meta.url))).toString()) as {
  snapshot:GameSnapshot;nextId:number;memories:Record<string,AiPolicyMemory>;
 };
 const snapshot=saved.snapshot;
 setBuildingBodies(snapshot.map,[...snapshot.buildings,...(snapshot.obstacles??[])]);
 beginShipCollisionFrame(snapshot.units,snapshot.map,[...snapshot.buildings,...(snapshot.obstacles??[])]);
 const options=bootstrapPolicyContext(snapshot,'p0',version,{memory:structuredClone(saved.memories.p0!)});
 const ship=snapshot.units.find(unit=>unit.id===id)!;
 const target=snapshot.buildings.find(building=>building.id===targetId)!;
 return {saved,snapshot,options,ship,target};
}
function hullCommands(value:ReturnType<typeof actual>){
 return planBootstrapNaval(value.snapshot,'p0',value.options).filter(command=>'unitIds' in command&&command.unitIds.includes(id));
}

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s explicitly attacks its real selected coastal building after native station completion',version=>{
 const value=actual(version),{snapshot,ship,saved}=value;
 expect(snapshot.tick).toBe(267300);
 expect(ship.order.type).toBe('idle');
 expect(ship.sailing!.route).toMatchObject({partial:false,points:[]});
 expect(ship.arrivedAt).toEqual(value.options.memory.naval!.coastalVoyages![id]!.waypoint);
 const before=JSON.stringify(saved);
 expect(hullCommands(value)).toEqual([{type:'attack',unitIds:[id],targetId}]);
 expect(value.options.memory.naval!.combat![id]!.targetId).toBe(targetId);
 expect(value.options.memory.naval!.combat![id]!.commandTargetId).toBe(targetId);
 expect(JSON.stringify(saved)).toBe(before);
});

it('corrects a mechanical attack-move target even when the strategy command cache still names its building',()=>{
 const value=actual();
 // Counterfactual order/cache isolation, not a second played frame. The
 // actual continuation separately records the native spirit replacement.
 const spirit=value.snapshot.units.find(unit=>unit.owner==='p2'&&unit.kind==='spirit'&&unit.hp>0)!;
 value.ship.order={type:'attackMove',x:value.target.x,y:value.target.y,targetId:spirit.id};
 value.options.memory.naval!.combat![id]!.commandTargetId=targetId;
 expect(hullCommands(value)).toEqual([{type:'attack',unitIds:[id],targetId}]);
});

it('keeps an existing explicit attack on the same strategic building',()=>{
 const value=actual();value.ship.order={type:'attack',targetId};
 expect(hullCommands(value)).toEqual([]);
});

it('preserves the original cached mechanical engagement for a unit quarry',()=>{
 const value=actual();
 const quarry=value.snapshot.units.find(unit=>unit.owner==='p2'&&unit.kind==='spirit'&&unit.hp>0)!;
 value.ship.order={type:'attackMove',x:quarry.x,y:quarry.y,targetId:'different-native-quarry'};
 value.options.memory.naval!.combat![id]={targetId:quarry.id,commandTargetId:quarry.id};
 expect(fleetAttackCommand(value.ship,quarry,value.options.memory.naval!)).toBeUndefined();
});
