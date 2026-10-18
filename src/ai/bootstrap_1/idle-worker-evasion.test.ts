import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {expect,it} from 'vitest';
import {idleWorkerEvasion} from './idle-worker-evasion';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {planAiOwnerCommandEntries} from '../planner-context';
const ids=['unit-p0-worker-1554','unit-p0-worker-2130','unit-p0-worker-2157'];
function saved(){const f=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/home-relief-54600.json.gz',import.meta.url))).toString());const game=createGame('bareDuel');restoreSnapshotIntoGame(game,f.snapshot,f.nextId);return {s:snapshotGame(game),memory:f.memories.p0};}
it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s gives actually idle exposed workers ordinary safe movement',version=>{
 const {s,memory}=saved(),options={memory,teams:s.teams!};const entries=planAiOwnerCommandEntries(s,{playerId:'p0',version,memory},{teams:s.teams!});
 const commands=entries.filter(e=>e.scriptId==='idleWorkerEvasion').map(e=>e.command);
 for(const id of ids)expect(commands.some(c=>c.type==='move'&&c.avoidCombat&&c.unitIds.includes(id))).toBe(true);
});
it('preserves planned jobs, boarding, carried income, and an existing non-evasion move',()=>{
 const {s,memory}=saved();s.units.find(u=>u.id===ids[1])!.order={type:'board',transportId:'unit-p0-transport-5237'};s.units.find(u=>u.id===ids[2])!.carryingGold=1;
 expect(idleWorkerEvasion(s,'p0',{memory,teams:s.teams!},[{type:'move',unitIds:[ids[0]!],x:5000,y:5000}])).toEqual([]);
 s.units.find(u=>u.id===ids[0])!.order={type:'move',x:5000,y:5000,avoidCombat:true};
 expect(idleWorkerEvasion(s,'p0',{memory,teams:s.teams!},[])).toEqual([]);
});
it('leaves distant idle workers alone',()=>{const {s,memory}=saved();for(const id of ids){const u=s.units.find(u=>u.id===id)!;u.x=4200;u.y=7100;}expect(idleWorkerEvasion(s,'p0',{memory,teams:s.teams!},[])).toEqual([]);});
