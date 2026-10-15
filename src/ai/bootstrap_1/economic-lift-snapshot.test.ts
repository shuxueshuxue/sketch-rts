import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {BUILDING_DEFS,UNIT_DEFS} from '../../shared/catalog';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {bootstrapPolicyContext} from './policy';
import {planBootstrapEconomy} from './economy';
import {colonyNavalWant,navalBudgetReserve} from '../policy/naval';

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s funds the next working colony while the fleet carries its assault',version=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-economic-lift.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const snapshot=snapshotGame(game),options=bootstrapPolicyContext(snapshot,'p0',version,{memory:saved.memory,teams:game.teams});
 expect(navalBudgetReserve(snapshot,'p0',options)).toBe(BUILDING_DEFS.townHall.cost+UNIT_DEFS.transport.cost);
 expect(colonyNavalWant(snapshot,'p0',options)?.id).toBe('naval:transport');
 expect(planBootstrapEconomy(snapshot,'p0',options)).toContainEqual({type:'train',buildingId:snapshot.buildings.find(b=>b.owner==='p0'&&b.kind==='shipyard')!.id,unitKind:'transport'});
 const memory=structuredClone(saved.memory);
 const ferry=Object.values(memory.naval.ferries)[0] as {phase:string};ferry.phase='return';
 const available=bootstrapPolicyContext(snapshot,'p0',version,{memory,teams:game.teams});
 expect(navalBudgetReserve(snapshot,'p0',available)).toBe(BUILDING_DEFS.townHall.cost);
 expect(colonyNavalWant(snapshot,'p0',available)?.id).not.toBe('naval:transport');
});
