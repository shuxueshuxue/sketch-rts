import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {bootstrapPolicyContext} from './policy';
import {mountedField,mountedFieldPlans} from './mounted-field';
import {planAiOwnerCommandEntries} from '../planner-context';

it('executes the admitted mounted road in the real pineshade crash frame',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/mounted-field-pineshade.json.gz',import.meta.url))).toString());
 const game=createGame('pineshade');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const snapshot=snapshotGame(game),options=bootstrapPolicyContext(snapshot,saved.owner,'v9_archer',{memory:saved.memory,teams:game.teams});
 const plans=mountedFieldPlans(snapshot,saved.owner,options);
 const commands=mountedField.run(snapshot,saved.owner,options);
 for(const {rider,road} of plans)if(road)expect(commands.filter(c=>c.type==='move'&&c.unitIds.includes(rider.id)).length).toBe(road.points.length-1);
 expect(()=>planAiOwnerCommandEntries(snapshot,{playerId:saved.owner,version:'v9_archer',memory:structuredClone(saved.memory)},{teams:game.teams})).not.toThrow();
});
