import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { goalCampId, goalCampMemberIds, goalFact, goalResourceKey, resolveGoalCamp } from './goal-facts';

it('keys facts by values, not field order, and keeps native camp and location semantics distinct', () => {
  const at = { landId: 'land:1' as const, point: { x: 100, y: 200 } };
  const original = { kind: 'force-at' as const, at, minimum: 4, byTick: 900, metric: 'camp-force' as const, campId: 'a' };
  const before = JSON.stringify(original);
  expect(goalFact(original).id).toBe(goalFact({ campId: 'a', metric: 'camp-force', byTick: 900, minimum: 4, at, kind: 'force-at' }).id);
  expect(goalFact({ ...original, campId: 'b' }).id).not.toBe(goalFact(original).id);
  expect(goalFact({ ...original, byTick: 901 }).id).not.toBe(goalFact(original).id);
  const safe = { kind: 'assets-safe' as const, unitIds: ['b', 'a', 'a'], at, throughTick: 100 };
  expect(goalFact(safe)).toEqual(goalFact({ ...safe, unitIds: ['a', 'b'] }));
  expect(JSON.stringify(original)).toBe(before);
  const elsewhere = { ...at, point: { x: 900, y: 1000 } };
  expect(goalFact({ kind: 'unit-available', unitKind: 'footman', count: 2, at, byTick: 900 }).id)
    .toBe(goalFact({ kind: 'unit-available', unitKind: 'footman', count: 2, at: elsewhere, byTick: 900 }).id);
  expect(goalFact({ ...original, at: elsewhere }).id).not.toBe(goalFact(original).id);
  expect(goalResourceKey({ kind: 'force', at, scope: 'pool', metric: 'combat-rating' }))
    .not.toBe(goalResourceKey({ kind: 'force', at, scope: 'post', metric: 'combat-rating' }));
  expect(goalFact({ ...original, cohort: [{ kind: 'existing', entityId: 'a' }, { kind: 'existing', entityId: 'b' }] }).id)
    .toBe(goalFact({ ...original, cohort: [{ kind: 'existing', entityId: 'b' }, { kind: 'existing', entityId: 'a' }] }).id);
  expect(goalFact({ ...original, cohort: [{ kind: 'existing', entityId: 'a' }] }).id)
    .not.toBe(goalFact({ ...original, cohort: [{ kind: 'existing', entityId: 'b' }] }).id);
});

it('resolves the original native camp after a member dies and observes clearing without task memory', () => {
  const scene = sketchScene('goal-camp-identity').map('bareDuel').replaceDefaults()
    .player('us').unit('neutral', 'footman', 1200, 1200, { id: 'guard-a' })
    .unit('neutral', 'footman', 1230, 1200, { id: 'guard-b' });
  const snapshot = snapshotGame(scene.build().createGame());
  const camp = neutralCampExposure(snapshot).camps[0]!, id = goalCampId(camp.memberIds);
  expect(goalCampMemberIds(id)).toEqual(['guard-a', 'guard-b']);
  expect(resolveGoalCamp(snapshot, id).status).toBe('present');
  snapshot.units.find(unit => unit.id === 'guard-a')!.hp = 0;
  const remaining = resolveGoalCamp(snapshot, id);
  expect(remaining.status).toBe('present');
  if (remaining.status === 'present') expect(remaining.exposure.memberIds).toEqual(['guard-b']);
  snapshot.units.find(unit => unit.id === 'guard-b')!.hp = 0;
  expect(resolveGoalCamp(snapshot, id)).toEqual({ status: 'cleared', originalMemberIds: ['guard-a', 'guard-b'] });
  expect(resolveGoalCamp(snapshot, 'camp:bad')).toEqual({ status: 'invalid' });
});
