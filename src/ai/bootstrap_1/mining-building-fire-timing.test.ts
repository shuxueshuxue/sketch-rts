import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { planEconomy } from '../policy/core';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';
import { miningJobSafety } from './mining-job-defense';

/** Captured during the exact original8da11400→12300 normal3AI reconstruction.
 * All original public commands, native hits and three-owner plan/memory rows,
 * and the original12000 full world/id/three memories closed before use here.
 * These are not original on-site periodic saves or changed-code match results. */
function actual(tick: 11565 | 11745 | 12285) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/mining-building-fire-${tick}.json.gz`, import.meta.url))).toString());
  const snapshot: GameSnapshot = saved.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const options: AiPolicyContext = { memory: saved.memories.p0, ...(snapshot.teams ? { teams: snapshot.teams } : {}) };
  const context = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', options);
  return { snapshot, context };
}

function economy(snapshot: GameSnapshot, context: AiPolicyContext) {
  const script = bootstrapScripts('v9_archer').find(script => script.id === 'economy')!;
  return runAiCommandEntriesFromScripts(snapshot, 'p0', [script], context).map(entry => entry.command);
}

it('preserves actual11565 first mining while the only nearby enemy tower is unfinished', () => {
  const { snapshot, context } = actual(11565);
  const tower = snapshot.buildings.find(building => building.id === 'building-p2-defenseTower-5114')!;
  expect(tower.complete).toBe(false);
  expect(tower.buildProgress).toBe(93);
  expect(economy(snapshot, context).some(command => command.type === 'mine' && command.resourceId === 'gold-gen-5'
    && command.unitIds.includes('unit-p0-worker-1379'))).toBe(true);
});

it('does not move actual11745 main-mine worker1034 into a now-working enemy tower', () => {
  const { snapshot, context } = actual(11745);
  const worker = snapshot.units.find(unit => unit.id === 'unit-p0-worker-1034')!;
  expect(worker.order).toMatchObject({ type: 'mine', resourceId: 'gold-seat0-main', phase: 'gather' });
  expect(snapshot.buildings.find(building => building.id === 'building-p2-defenseTower-5114')!.complete).toBe(true);
  expect(miningJobSafety.claimsUnits!(snapshot, 'p0', context).has(worker.id)).toBe(false);
  // Generic economy keeps its original default. Only the bootstrap wrapper
  // injects current building-fire admission; frozen policies are unchanged.
  expect(planEconomy(snapshot, 'p0', context)).toMatchObject({ type: 'mine', resourceId: 'gold-gen-5',
    unitIds: expect.arrayContaining([worker.id]) });
  expect(economy(snapshot, context).some(command => command.type === 'mine' && command.resourceId === 'gold-gen-5'
    && command.unitIds.includes(worker.id))).toBe(false);
});

it('does not newly send actual12285 idle worker5725 back under two working towers', () => {
  const { snapshot, context } = actual(12285);
  const worker = snapshot.units.find(unit => unit.id === 'unit-p0-worker-5725')!;
  expect(worker.order).toEqual({ type: 'idle' });
  expect(['building-p2-defenseTower-5114', 'building-p2-defenseTower-5405'].every(id =>
    snapshot.buildings.find(building => building.id === id)?.complete)).toBe(true);
  expect(economy(snapshot, context).some(command => command.type === 'mine' && command.resourceId === 'gold-gen-5'
    && command.unitIds.includes(worker.id))).toBe(false);
});
