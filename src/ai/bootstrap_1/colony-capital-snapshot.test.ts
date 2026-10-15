import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {BUILDING_DEFS} from '../../shared/catalog';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {issueCommandFrame} from '../../sdk/commands/frame';
import {sameGround} from '../../shared/terrain';
import {bootstrapPolicyContext,bootstrapScripts} from './policy';
import {runAiCommandEntriesFromScripts} from '../policy/script-runner';

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s funds the real threatened colony without diverting its savings to home recruits',version=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-colony-capital.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const snapshot=snapshotGame(game),options=bootstrapPolicyContext(snapshot,'p0',version,{memory:saved.memory,teams:game.teams});
 const entries=runAiCommandEntriesFromScripts(snapshot,'p0',bootstrapScripts(version),options);
 const home=snapshot.buildings.find(b=>b.id==='building-p0-townhall')!;
 expect(entries.some(e=>e.command.type==='build' && e.command.buildingKind==='barracks'
  && !sameGround(snapshot.map,home,e.command))).toBe(true);
 expect(entries.filter(e=>e.command.type==='train' && sameGround(snapshot.map,home,snapshot.buildings.find(b=>e.command.type==='train'&&b.id===e.command.buildingId)!))).toEqual([]);
 issueCommandFrame(game,entries.map(e=>({...e,playerId:'p0'})));
 // Walking construction has not yet debited the balance; include its commitment.
 expect(game.players.p0!.gold-BUILDING_DEFS.barracks.cost).toBeGreaterThanOrEqual(BUILDING_DEFS.townHall.cost);
});
