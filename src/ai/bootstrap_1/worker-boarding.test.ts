import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {planAiOwnerCommandEntries} from '../planner-context';
import {passengerBoardingSafe} from './worker-boarding';
import {boardingBerth} from '../../shared/naval';

function saved(tick:number){
 const input=JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/worker-boarding-knight-${tick}.json.gz`,import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,input.snapshot,input.nextId);
 const snapshot=snapshotGame(game),memory=structuredClone(input.memories.p0);
 const entries=planAiOwnerCommandEntries(snapshot,{playerId:'p0',version:'v9_knight',memory},{teams:{p0:'a',p1:'b'}});
 return{snapshot,memory,commands:entries.map(entry=>entry.command)};
}

it.each([[134175,'unit-p0-worker-11845'],[134595,'unit-p0-worker-13542']]as const)('does not send real miner %s to the far hull’s dangerous native shore', (tick,id)=>{
 const {snapshot,memory,commands}=saved(tick);
 expect(snapshot.units.find(unit=>unit.id===id)?.order.type).toBe('mine');
 expect(commands.some(command=>command.type==='board'&&command.unitIds.includes(id))).toBe(false);
 expect(memory.naval?.ferries?.['unit-p0-carrier-6933']?.crewIds).not.toContain(id);
});

it.each([[134160,'unit-p0-worker-3'],[134580,'unit-p0-worker-11845'],[135000,'unit-p0-worker-13542']]as const)('releases the existing unsafe shore worker at real frame %s within its naval owner', (tick,id)=>{
 const {snapshot,memory,commands}=saved(tick);
 expect(snapshot.units.find(unit=>unit.id===id)).toMatchObject({hp:2,order:{type:'board'}});
 expect(commands.some(command=>command.type==='stop'&&command.unitIds.includes(id))).toBe(true);
 expect(commands.some(command=>command.type==='board'&&command.unitIds.includes(id))).toBe(false);
 expect(memory.naval?.ferries?.['unit-p0-carrier-6933']?.crewIds).not.toContain(id);
});

it('preserves the actual deck worker and does not alter its native mission',()=>{
 const {snapshot,memory}=saved(134175);
 const worker=snapshot.units.find(unit=>unit.id==='unit-p0-worker-1008')!;
 const boat=snapshot.units.find(unit=>unit.id===worker.deck!.shipId)!;
 const before=JSON.stringify({worker,boat,memory});
 expect(passengerBoardingSafe(snapshot,'p0',{memory,teams:{p0:'a',p1:'b'}},worker,boat)).toBe(true);
 expect(JSON.stringify({worker,boat,memory})).toBe(before);
});

it('admits the native safe shore after a counterfactual close hull pose, without a coarse-source contact gate',()=>{
 const {snapshot,memory}=saved(134175);
 const worker=snapshot.units.find(unit=>unit.id==='unit-p0-worker-11845')!;
 const boat=snapshot.units.find(unit=>unit.id==='unit-p0-carrier-6933')!;
 const from=memory.naval!.ferries![boat.id]!.from;
 // Pure geometry counterfactual; this is not an observed voyage or a restore edit.
 const close={...boat,...from};
 expect(boardingBerth(snapshot.map,worker,close)?.shore).toMatchObject(from);
 expect(passengerBoardingSafe(snapshot,'p0',{memory,teams:{p0:'a',p1:'b'}},worker,close)).toBe(true);
});
