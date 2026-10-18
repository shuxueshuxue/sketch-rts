import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { planAiOwnerCommandEntries } from '../planner-context';

const boatId='unit-p0-transport-1070';
function saved(){
  const frame=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/settler-sea-9000.json.gz',import.meta.url))).toString());
  const game=createGame('bareDuel');restoreSnapshotIntoGame(game,frame.snapshot,frame.nextId);
  return {game,memory:frame.memories.p0};
}
it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s detours the exposed settlers despite nominal escort superiority',version=>{
  const {game,memory}=saved();
  const entries=planAiOwnerCommandEntries(snapshotGame(game),{playerId:'p0',version,memory},{teams:game.teams});
  const orders=entries.filter(e=>'unitIds'in e.command&&e.command.unitIds.includes(boatId));
  expect(orders).toHaveLength(1);
  expect(orders[0]!.command).toMatchObject({type:'move',avoidCombat:true});
  const mark=memory.naval.settlerSeaMarks[boatId];
  expect(mark.waypoint.x).toBeLessThan(4500);
  expect(mark.waypoint.y).toBeLessThan(5808);
});
it('does not divert a settler voyage without enemy ships',()=>{
  const {game,memory}=saved();game.units=game.units.filter(u=>!u.sailing||u.owner==='p0');
  planAiOwnerCommandEntries(snapshotGame(game),{playerId:'p0',version:'v9_archer',memory},{teams:game.teams});
  expect(memory.naval.settlerSeaMarks[boatId]).toBeUndefined();
});
