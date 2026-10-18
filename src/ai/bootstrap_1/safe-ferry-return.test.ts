import {planAiOwnerCommandEntries} from '../planner-context';
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame,issuePlayerCommand} from '../../shared/sim';
import {safeFerryReturn} from './safe-ferry-return';
import {bootstrapPolicyContext,BOOTSTRAP_VERSIONS} from './policy';

function saved(arrival=false){const f=JSON.parse(gunzipSync(readFileSync(new URL(arrival?'./fixtures/failed-colony-return-scoped-37305.json.gz':'./fixtures/failed-colony-return-36600.json.gz',import.meta.url))).toString());const g=createGame('bareDuel');restoreSnapshotIntoGame(g,f.snapshot,f.nextId);return {g,memory:f.memories.p0};}
const shipId='unit-p0-transport-5237';
it.each(BOOTSTRAP_VERSIONS)('%s sends the failed colony home through a complete native voyage',v=>{
 const {g,memory}=saved(),s=snapshotGame(g),before=JSON.stringify(s),o=bootstrapPolicyContext(s,'p0',v,{memory,teams:g.teams});
 const r=safeFerryReturn(s,'p0',o,[{type:'unload',unitIds:[shipId],x:1424,y:4016}]);
 expect(r.commands).toEqual([{type:'move',unitIds:[shipId],x:4976,y:6192,avoidCombat:true}]);expect(r.proofs[0]).toMatchObject({hallId:'building-p0-townhall',route:{partial:false}});expect(JSON.stringify(s)).toBe(before);
});
it('uses the public passenger API only when a safe native landing actually exists',()=>{const {g,memory}=saved(true),s=snapshotGame(g),gold=g.players.p0!.gold;const r=safeFerryReturn(s,'p0',{memory,teams:g.teams},[]);expect(r.commands.some(c=>c.type==='unloadPassenger')).toBe(true);for(const c of r.commands)issuePlayerCommand(g,'p0',c);const u=g.units.find(u=>u.id==='unit-p0-worker-1')!;expect(u.deck).toBeUndefined();expect(u.hp).toBe(70);expect(g.players.p0!.gold).toBe(gold);});
it('preserves an existing emergency helm move',()=>{const {g,memory}=saved();const c={type:'move' as const,unitIds:[shipId],x:3600,y:5300,avoidCombat:true};expect(safeFerryReturn(snapshotGame(g),'p0',{memory,teams:g.teams},[c]).commands).toEqual([c]);});
it('does not redirect a mission that is still sailing to its colony',()=>{const {g,memory}=saved();memory.naval.ferries[shipId].phase='sailing';const c={type:'unload' as const,unitIds:[shipId],x:4688,y:3536};expect(safeFerryReturn(snapshotGame(g),'p0',{memory,teams:g.teams},[c]).commands).toEqual([c]);});
it('does not invent a safe return when every owned hall is gone',()=>{const {g,memory}=saved();g.buildings=g.buildings.filter(b=>b.owner!=='p0'||b.kind!=='townHall');const r=safeFerryReturn(snapshotGame(g),'p0',{memory,teams:g.teams},[{type:'unload',unitIds:[shipId],x:1424,y:4016}]);expect(r.commands).toEqual([{type:'stop',unitIds:[shipId]}]);});

it('leaves evacuation missions with their existing owner',()=>{const {g,memory}=saved();memory.naval.ferries[shipId].purpose='evacuate';const c={type:'unload' as const,unitIds:[shipId],x:4368,y:6032};expect(safeFerryReturn(snapshotGame(g),'p0',{memory,teams:g.teams},[c]).commands).toEqual([c]);});

it.each(BOOTSTRAP_VERSIONS)('%s integrates the safer return in its actual planner',version=>{
 const {g,memory}=saved();const entries=planAiOwnerCommandEntries(snapshotGame(g),{playerId:'p0',version,memory},{teams:g.teams});
 const helm=entries.filter(e=>'unitIds'in e.command&&e.command.unitIds.includes(shipId));
 expect(helm).toHaveLength(1);expect(helm[0]!.command).toMatchObject({type:'move',x:4976,y:6192,avoidCombat:true});
});

it.each(BOOTSTRAP_VERSIONS)('%s keeps the original safe return instead of unloading early',version=>{
 const f=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/safe-colony-return-13470.json.gz',import.meta.url))).toString());
 const g=createGame('bareDuel');restoreSnapshotIntoGame(g,f.snapshot,f.nextId);
 const entries=planAiOwnerCommandEntries(snapshotGame(g),{playerId:'p0',version,memory:f.memories.p0},{teams:g.teams});
 const relevant=entries.filter(e=>('unitIds'in e.command&&e.command.unitIds.includes('unit-p0-transport-1070'))||(e.command.type==='unloadPassenger'&&e.command.transportId==='unit-p0-transport-1070'));
 expect(relevant.map(e=>e.command)).toEqual([{type:'unload',unitIds:['unit-p0-transport-1070'],x:4368,y:6032,avoidCombat:true}]);
 expect(f.memories.p0.safeFerryReturns).toBeUndefined();
});
it('retains ownership after changing a stale departure to the safe coast',()=>{
 const {g,memory}=saved(),s=snapshotGame(g),options={memory,teams:g.teams};
 const first=safeFerryReturn(s,'p0',options,[]);expect(memory.safeFerryReturns[shipId]).toBeDefined();
 const second=safeFerryReturn(s,'p0',options,[{type:'unload',unitIds:[shipId],x:4976,y:6192}]);expect(second.commands).toEqual(first.commands);
});
it('clears the old return marker when the hull starts a new voyage',()=>{
 const {g,memory}=saved(),s=snapshotGame(g),options={memory,teams:g.teams};safeFerryReturn(s,'p0',options,[]);
 memory.naval.ferries[shipId].phase='loading';safeFerryReturn(s,'p0',options,[]);expect(memory.safeFerryReturns).toBeUndefined();
});
