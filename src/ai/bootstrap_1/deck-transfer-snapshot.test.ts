import {bootstrapPolicyContext,bootstrapScripts} from './policy';
import {runAiCommandEntriesFromScripts} from '../policy/script-runner';
import {navalServices} from '../policy/naval-services';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame,stepGame,issuePlayerCommand} from '../../shared/sim';
import {clearTransferLanes} from '../policy/transfer-lanes';
import {canBoard} from '../../shared/decks';

it('clears the idle archer blocking the real ballista deck crossing',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-deck-transfer.json.gz',import.meta.url))).toString());
 for(const clear of [false,true]) {
  const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
  const passenger=game.units.find(u=>u.id==='unit-p0-ballista-3726')!,target=game.units.find(u=>u.id==='unit-p0-warship-1115')!;
  expect(canBoard(target,passenger,game.units)).toBe(true);
  const losses=game.match.stats.unitsLost.p0;
  let restored:ReturnType<typeof createGame>|undefined;
  for(let tick=0;tick<900 && passenger.deck?.shipId!==target.id;tick++) {
   if(clear && !restored && passenger.order.type==='hold' && passenger.orderQueue?.some(order=>order.type==='board')) {
    const checkpoint=JSON.parse(JSON.stringify({snapshot:snapshotGame(game),nextId:game.nextId}));
    restored=createGame('bareDuel');restoreSnapshotIntoGame(restored,checkpoint.snapshot,checkpoint.nextId);
   }
   for(const branch of [game,...(restored?[restored]:[])]) {
    if(clear && tick%15===0)for(const command of clearTransferLanes(snapshotGame(branch),'p0'))issuePlayerCommand(branch,'p0',command);
    stepGame(branch);
   }
  }
  expect(passenger.deck?.shipId===target.id).toBe(clear);
  expect(game.match.stats.unitsLost.p0).toBe(losses);
  if(clear) {
   expect(restored).toBeDefined();
   expect(snapshotGame(restored!)).toEqual(snapshotGame(game));
   expect(restored!.nextId).toBe(game.nextId);
  }
 }
},60000);

it('preserves the yielding queue and both hull reservations through the complete planner',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-deck-transfer.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const snapshot=snapshotGame(game),options=bootstrapPolicyContext(snapshot,'p0','v9_archer',{memory:saved.memory,teams:game.teams});
 const before=JSON.stringify(snapshot.units);
 const commands=runAiCommandEntriesFromScripts(snapshot,'p0',bootstrapScripts('v9_archer'),options);
 expect(JSON.stringify(snapshot.units)).toBe(before);
 for(const entry of commands)issuePlayerCommand(game,'p0',entry.command);
 const passenger=game.units.find(u=>u.id==='unit-p0-ballista-3726')!;
 expect(passenger.order.type).toBe('move');
 expect(passenger.orderQueue?.map(order=>order.type)).toEqual(['hold','board']);
 const services=navalServices(snapshotGame(game),'p0',options);
 for(const id of [passenger.id,'unit-p0-carrier-9100','unit-p0-warship-1115'])expect(services.reserved.has(id)).toBe(true);
});

it('leaves a deck defender with a combat order in control of its position',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-deck-transfer.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const archer=game.units.find(u=>u.id==='unit-p0-archer-5787')!;
 archer.order={type:'attack',targetId:'building-p1-townhall'};
 expect(clearTransferLanes(snapshotGame(game),'p0').some(command=>'unitIds' in command && command.unitIds.includes(archer.id))).toBe(false);
});
