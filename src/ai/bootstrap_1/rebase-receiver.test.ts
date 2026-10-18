import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {planAiOwnerCommandEntries} from '../planner-context';
import {BOOTSTRAP_VERSIONS} from './policy';
const ship='unit-p0-carrier-3009';
function saved(live=false){const f=JSON.parse(gunzipSync(readFileSync(new URL(live?'./fixtures/rebase-live-hall-47400.json.gz':'./fixtures/rebase-lost-hall-48000.json.gz',import.meta.url))).toString());const g=createGame('bareDuel');restoreSnapshotIntoGame(g,f.snapshot,f.nextId);return {g,memory:f.memories.p0};}
it.each(BOOTSTRAP_VERSIONS)('%s cancels a workforce transfer after its receiving hall is destroyed',version=>{
 const {g,memory}=saved();const mission=memory.naval.ferries[ship];expect(mission.phase).toBe('sailing');expect(g.units.filter(u=>u.deck?.shipId===ship&&u.kind==='worker')).toHaveLength(5);
 const entries=planAiOwnerCommandEntries(snapshotGame(g),{playerId:'p0',version,memory},{teams:g.teams});
 expect(memory.naval.ferries[ship].phase).toBe('return');
 expect(entries.some(e=>e.command.type==='unload'&&e.command.unitIds.includes(ship)&&e.command.x===mission.to.x&&e.command.y===mission.to.y)).toBe(false);
});
it.each(BOOTSTRAP_VERSIONS)('%s preserves transfer while its receiving hall still exists',version=>{
 const {g,memory}=saved(true);const goal={...memory.naval.ferries[ship].to};const entries=planAiOwnerCommandEntries(snapshotGame(g),{playerId:'p0',version,memory},{teams:g.teams});
 expect(memory.naval.ferries[ship].phase).toBe('sailing');expect(g.units.find(u=>u.id===ship)!.order).toMatchObject({type:'unload',...goal});expect(entries.some(e=>e.command.type==='unload'&&e.command.unitIds.includes(ship)&&(e.command.x!==goal.x||e.command.y!==goal.y))).toBe(false);
});
