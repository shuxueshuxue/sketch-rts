import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { retainGoalGuardWindows, goalGarrisonThroughTick } from './goal-guard-window';
import { readGoalObjective, restoreGoalAuthorityReferences } from './goal-authority-references';
import { retainCommittedGoalObjectives } from './goal-commitment-objectives';

it('anchors the real original garrison end across collector refresh and JSON recovery', () => {
  const original = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-capital-597-near-6840.json.gz', import.meta.url))).toString());
  const authority = restoreGoalAuthorityReferences(original.memoryBefore.strategyAllocation);
  const definition = readGoalObjective(authority, 'ConquerIsland:planner:resource-1')!;
  const refreshed = { ...definition, sinceTick: 6840 };
  const retained = retainCommittedGoalObjectives(authority, [refreshed]).find(goal => goal.id === definition.id)!;
  const effect = retained.effects.find(effect => effect.kind === 'mining-established')!;
  expect(effect).toMatchObject({ kind: 'mining-established', garrisonThroughTick: 12015 });
  if (effect.kind !== 'mining-established') throw Error('original mining effect');
  expect(goalGarrisonThroughTick(retained, effect)).toBe(12015);
  expect(retainGoalGuardWindows(JSON.parse(JSON.stringify(retained)), definition)).toEqual(retained);
});

it('preserves an explicit world obligation end independently of quote clocks', () => {
  const original = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-capital-597-near-6840.json.gz', import.meta.url))).toString());
  const authority = restoreGoalAuthorityReferences(original.memoryBefore.strategyAllocation);
  const definition = readGoalObjective(authority, 'ConquerIsland:planner:resource-1')!;
  const current = { ...definition, sinceTick: 6840, effects: definition.effects.map(effect => effect.kind === 'mining-established'
    ? { ...effect, garrisonThroughTick: 20000 } : effect) };
  expect(retainGoalGuardWindows(current, definition).effects).toContainEqual(expect.objectContaining({
    kind: 'mining-established', garrisonThroughTick: 20000 }));
});
