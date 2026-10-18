import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {planMiningWorkforce} from './workforce';

const hallId='building-p0-townHall-5659';
function saved(){
 const f=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/workforce-evacuation-27750.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,f.snapshot,f.nextId);
 return {game,memory:f.memories.p0};
}
function orders(game:ReturnType<typeof createGame>,memory:any){
 return planMiningWorkforce(snapshotGame(game),'p0',3,{memory,teams:game.teams});
}
it('does not refill the actual mining post whose crew is being evacuated under fire',()=>{
 const {game,memory}=saved();
 expect(game.players.p0!.gold).toBeGreaterThan(50);
 expect(Object.values(memory.naval.ferries).some((m:any)=>m.purpose==='evacuate')).toBe(true);
 expect(orders(game,memory)).not.toContainEqual({type:'train',buildingId:hallId,unitKind:'worker'});
});
it('keeps the evacuation decision even when its visible attacker is removed',()=>{
 const {game,memory}=saved();game.units=game.units.filter(u=>u.owner==='p0');
 expect(orders(game,memory)).not.toContainEqual({type:'train',buildingId:hallId,unitKind:'worker'});
});
it('does not recruit directly into observed attack coverage without a ferry mission',()=>{
 const {game,memory}=saved();memory.naval.ferries={};
 expect(orders(game,memory)).not.toContainEqual({type:'train',buildingId:hallId,unitKind:'worker'});
});
it('resumes ordinary worker demand after the threat and evacuation are gone',()=>{
 const {game,memory}=saved();memory.naval.ferries={};game.units=game.units.filter(u=>u.owner==='p0');
 expect(orders(game,memory)).toContainEqual({type:'train',buildingId:hallId,unitKind:'worker'});
});
