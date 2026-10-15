import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame,issuePlayerCommand} from '../../shared/sim';
import {bootstrapPolicyContext,bootstrapScripts} from './policy';
import {runAiCommandEntriesFromScripts} from '../policy/script-runner';
import {planShoreTransfers} from './shore-transfer';
const scene=()=>{
 const data=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/summoner-cutter-transfer.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,data.snapshot,data.nextId);return {game,memory:data.memory};
};
it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s uses a safe real shore when the requested deck yield is unreachable',version=>{
 const {game,memory}=scene(),snapshot=snapshotGame(game),before=JSON.stringify(snapshot);
 const options=bootstrapPolicyContext(snapshot,'p0',version,{memory,teams:game.teams});
 const entries=runAiCommandEntriesFromScripts(snapshot,'p0',bootstrapScripts(version),options);
 expect(JSON.stringify(snapshot)).toBe(before);
 const unload=entries.findIndex(e=>e.command.type==='unloadPassenger'&&e.command.passengerId==='unit-p0-summoner-1488');
 expect(unload).toBeGreaterThanOrEqual(0);
 expect(entries.slice(unload+1).some(e=>e.command.type==='board'&&e.command.unitIds.includes('unit-p0-summoner-1488'))).toBe(true);
 for(const entry of entries)issuePlayerCommand(game,'p0',entry.command);
 const crew=game.units.find(u=>u.id==='unit-p0-summoner-1488')!;
 expect(crew.deck).toBeUndefined();expect(crew.order).toMatchObject({type:'board',transportId:'unit-p0-cutter-1130'});
});
it('does not disembark into an enemy-covered shore',()=>{
 const {game,memory}=scene();game.spawnUnit('p1','archer',7770,3800);
 const snapshot=snapshotGame(game),options=bootstrapPolicyContext(snapshot,'p0','v9_summoner',{memory,teams:game.teams});
 expect(planShoreTransfers(snapshot,'p0',options)).toEqual([]);
});
it('distinguishes an empty destination from a route blocked by live crew',async()=>{
 const {deckStaticPathExists,deckWalkPathExists}=await import('../../shared/decks');
 const {worldToLocal}=await import('../../shared/ship-geometry');
 const {game}=scene(),ballista=game.units.find(u=>u.id==='unit-p0-ballista-9884')!,ship=game.units.find(u=>u.id===ballista.deck!.shipId)!;
 if(ballista.order.type!=='move')throw new Error('Recorded ballista must retain its attempted yield');
 const goal=worldToLocal(ship,ballista.order);
 expect(deckStaticPathExists(ship,ballista,goal)).toBe(true);
 expect(deckWalkPathExists(ship,ballista,goal,game.units)).toBe(false);
});
it('does not command an enemy hull carrying an owned passenger',()=>{
 const {game,memory}=scene();game.units.find(u=>u.id==='unit-p0-transport-1046')!.owner='p1';
 const snapshot=snapshotGame(game),options=bootstrapPolicyContext(snapshot,'p0','v9_summoner',{memory,teams:game.teams});
 expect(planShoreTransfers(snapshot,'p0',options)).toEqual([]);
});
