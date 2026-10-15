import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame,stepGame,issuePlayerCommand} from '../../shared/sim';
import {bootstrapPolicyContext,bootstrapScripts} from './policy';
import {runAiCommandEntriesFromScripts} from '../policy/script-runner';
import {clearTransferLanes} from '../policy/transfer-lanes';

const saved=()=>JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/summoner-pickup-quay.json.gz',import.meta.url))).toString());
it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s requests a real boarding rendezvous before demanding contact with the coarse pickup point',version=>{
 const data=saved(),game=createGame('bareDuel');restoreSnapshotIntoGame(game,data.snapshot,data.nextId);
 // The first available hull claims the shore crew before the second hull is considered.
 const boat=game.units.find(u=>u.id==='unit-p0-carrier-36426')!;
 const options=bootstrapPolicyContext(snapshotGame(game),'p0',version,{memory:data.memory,teams:game.teams});
 const entries=runAiCommandEntriesFromScripts(snapshotGame(game),'p0',bootstrapScripts(version),options);
 const commands=entries.map(e=>e.command);
 const boarding=commands.find(c=>c.type==='board'&&c.transportId===boat.id);
 expect(boarding).toBeDefined();
 expect(commands.some(c=>c.type==='stop'&&c.unitIds.includes(boat.id))).toBe(true);
});
it('moves idle workers out of the actual occupied berth and completes a native pickup',()=>{
 const data=saved(),game=createGame('bareDuel');restoreSnapshotIntoGame(game,data.snapshot,data.nextId);
 const boat=game.units.find(u=>u.id==='unit-p0-carrier-50029')!;
 const ids=['unit-p0-footman-1071','unit-p0-summoner-1341'];
 issuePlayerCommand(game,'p0',{type:'board',unitIds:ids,transportId:boat.id});
 issuePlayerCommand(game,'p0',{type:'stop',unitIds:[boat.id]});
 const beforeLosses=game.match.stats.unitsLost.p0;
 let workersMoved=false;
 for(let tick=0;tick<1800&&!ids.every(id=>game.units.find(u=>u.id===id)?.deck?.shipId===boat.id);tick++) {
  if(tick%15===0)for(const command of clearTransferLanes(snapshotGame(game),'p0')) {
   if('unitIds' in command&&command.unitIds.some(id=>['unit-p0-worker-4685','unit-p0-worker-14920'].includes(id)))workersMoved=true;
   issuePlayerCommand(game,'p0',command);
  }
  stepGame(game);
 }
 expect(workersMoved).toBe(true);
 expect(ids.every(id=>game.units.find(u=>u.id===id)?.deck?.shipId===boat.id)).toBe(true);
 expect(game.match.stats.unitsLost.p0).toBe(beforeLosses);
});
it('does not commandeer mining or building workers to clear a berth',()=>{
 const data=saved(),game=createGame('bareDuel');restoreSnapshotIntoGame(game,data.snapshot,data.nextId);
 issuePlayerCommand(game,'p0',{type:'board',unitIds:['unit-p0-footman-1071'],transportId:'unit-p0-carrier-50029'});
 const miners=game.units.filter(u=>['unit-p0-worker-4685','unit-p0-worker-14920'].includes(u.id));
 miners[0]!.order={type:'mine',resourceId:'gold-satellite-5',phase:'toMine',timer:0};
 miners[1]!.order={type:'build',buildingKind:'farm',x:6200,y:3000};
 expect(clearTransferLanes(snapshotGame(game),'p0').some(c=>'unitIds' in c&&c.unitIds.some(id=>miners.some(u=>u.id===id)))).toBe(false);
});

it('keeps a partial invasion loading after its engineer boards, and assigns each walker to one ferry',async()=>{
 const {planBootstrapNaval}=await import('./expedition-recovery');
 const data=saved(),game=createGame('bareDuel');restoreSnapshotIntoGame(game,data.snapshot,data.nextId);
 const boat=game.units.find(u=>u.id==='unit-p0-carrier-36426')!;
 const options=bootstrapPolicyContext(snapshotGame(game),'p0','v9_summoner',{memory:data.memory,teams:game.teams});
 const commands=planBootstrapNaval(snapshotGame(game),'p0',options);
 const boarders=commands.flatMap(c=>c.type==='board'&&options.memory.naval?.ferries?.[c.transportId]?c.unitIds:[]);
 expect(new Set(boarders).size).toBe(boarders.length);
 for(const command of commands)issuePlayerCommand(game,'p0',command);
 const mission=options.memory.naval!.ferries![boat.id]!;
 const engineer=game.units.find(u=>mission.crewIds.includes(u.id)&&u.kind==='worker')!;
 expect(engineer).toBeDefined();
 for(let tick=0;tick<600&&!engineer.deck;tick++)stepGame(game);
 expect(engineer.deck?.shipId).toBe(boat.id);
 expect(game.units.some(u=>u.order.type==='board'&&u.order.transportId===boat.id)).toBe(true);
 const next=planBootstrapNaval(snapshotGame(game),'p0',options);
 expect(mission.phase).toBe('loading');
 expect(next.some(c=>c.type==='unload'&&c.unitIds.includes(boat.id))).toBe(false);
});
