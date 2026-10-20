import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot, AiScriptVersion } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import type { AiCommandEntry } from '../policy/types';

// Original bc33a34a match, before think; no changes to units, orders, terrain or memory.
const saved: { source: string; frames: { snapshot: GameSnapshot; owner: string; version: AiScriptVersion;
  beforeMemory: AiPolicyMemory; entries: (AiCommandEntry & { playerId: string; source: string })[] }[] } =
  JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/worker-continuation-broken-sea.json.gz', import.meta.url))).toString());

it.each(saved.frames)('preserves ordinary brokenSea orders byte-for-byte at $snapshot.tick', frame => {
  const entries = planAiOwnerCommandEntries(structuredClone(frame.snapshot),
    { playerId: frame.owner, version: frame.version, source: 'external-agent', memory: structuredClone(frame.beforeMemory) },
    frame.snapshot.teams ? { teams: frame.snapshot.teams } : {});
  expect(JSON.stringify(entries)).toBe(JSON.stringify(frame.entries));
  const actions = entries.filter(entry => 'unitId' in entry.command ? entry.command.unitId === 'unit-p1-worker-1'
    : 'unitIds' in entry.command && entry.command.unitIds.includes('unit-p1-worker-1'));
  if (frame.snapshot.tick === 7293) expect(actions).toEqual([]);
  if (frame.snapshot.tick === 7458) expect(actions).toEqual([expect.objectContaining({command:
    {type:'build',unitId:'unit-p1-worker-1',buildingKind:'townHall',x:3344,y:4176}})]);
}, 30000);

it('keeps the real interrupted farm as a vacancy instead of paying a worker replacement in excess travel', async()=>{
  const {createGame,restoreSnapshotIntoGame,snapshotGame,issuePlayerCommand,stepGame}=await import('../../shared/sim');
  const {workerContinuationCommands}=await import('../policy/worker-continuation');
  const {armedFoes}=await import('./safe-land-route');
  const {miningJobSafety}=await import('./mining-job-defense');
  const frame=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/worker-continuation-farm-18325.json.gz',import.meta.url))).toString());
  const game=createGame('bareDuel',{aiPlayers:[]});restoreSnapshotIntoGame(game,frame.snapshot,frame.nextId);
  const memory:AiPolicyMemory=structuredClone(frame.beforeMemory);
  const entries=planAiOwnerCommandEntries(snapshotGame(game),{playerId:frame.owner,version:'v9_archer',memory,scripts:[miningJobSafety]},{teams:game.teams});
  for(const entry of entries)issuePlayerCommand(game,entry.playerId,entry.command);
  expect(memory.unitClaims['unit-player-4-worker-2']?.evacuation?.continuation).toBeDefined();
  for(let tick=0;tick<15;tick++)stepGame(game);
  const snapshot=snapshotGame(game),worker=snapshot.units.find(unit=>unit.id==='unit-player-4-worker-2')!;
  const state=memory.unitClaims[worker.id]!.evacuation!.continuation!;
  expect(workerContinuationCommands(snapshot,worker,state,armedFoes(snapshot,frame.owner,{teams:game.teams}))).toBeUndefined();
  // A new ordinary dispatch, whose unsnapped point lands on the saved native
  // footprint, supersedes the parent. Its command bytes are never rewritten.
  const {planWorkerSafety,finishWorkerSafetyPlans}=await import('./worker-safety');
  const options={memory,version:'v9_archer' as const,teams:game.teams};
  planWorkerSafety(snapshot,frame.owner,options);
  const replacement:AiCommandEntry={scriptId:'v6Economy',command:{type:'build',unitId:'unit-player-4-worker-1019',buildingKind:'farm',x:4474.314575050762,y:1050.314575050762}};
  const before=JSON.stringify(replacement);
  finishWorkerSafetyPlans(snapshot,frame.owner,options,[replacement]);
  expect(memory.unitClaims[worker.id]?.evacuation?.continuation).toBeUndefined();
  expect(memory.workerContinuationEvents).toContainEqual(expect.objectContaining({kind:'end',reason:'new-site-order'}));
  expect(JSON.stringify(replacement)).toBe(before);
});
