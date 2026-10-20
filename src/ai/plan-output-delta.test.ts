import { expect, it } from 'vitest';
import { applyPlanOutputDelta, diffPlanOutput, type PlanOutputDelta } from './plan-output-delta';

const recorded = (delta: PlanOutputDelta) => JSON.parse(JSON.stringify(delta)) as PlanOutputDelta;

it('updates, removes and reorders stable rows without changing an earlier replay frame', () => {
  const before = { tick: 10, units: Array.from({ length: 120 }, (_, i) => ({
    id: `unit-${i}`, position: { x: i * 10, y: 20 }, hp: 100,
    orders: ['move', 'assemble', 'defend'], explanation: 'An unchanged recorded unit and its task evidence',
  })) };
  const original = JSON.stringify(before);
  const after = { tick: 20, units: [
    { ...before.units[90]!, hp: 72 },
    ...before.units.filter(row => row.id !== 'unit-90' && row.id !== 'unit-2'),
    { ...before.units[0]!, id: 'unit-new' },
  ] };
  const delta = diffPlanOutput(before, after)!;
  expect(JSON.stringify(delta).length).toBeLessThan(JSON.stringify(after).length / 5);
  expect(applyPlanOutputDelta(before, recorded(delta))).toEqual(after);
  expect(JSON.stringify(before)).toBe(original);
  expect(diffPlanOutput(after, JSON.parse(JSON.stringify(after)))).toBeUndefined();
});

it('preserves objective and action keys, explicit field removal and action generations', () => {
  const before = { objectives: Array.from({ length: 30 }, (_, i) => ({
    objectiveId: `objective-${i}`, status: 'active', reason: 'A recorded allocation reason with unchanged evidence',
  })), executions: Array.from({ length: 30 }, (_, i) => ({
    token: { actionId: `action-${i}`, generation: 1 }, phase: 'assemble', state: { camp: 'camp-1', next: 'clear' },
  })), optional: { source: 'recorded' } };
  const after = { objectives: before.objectives.slice(1), executions: [
    { ...before.executions[0]!, token: { actionId: 'action-0', generation: 2 }, phase: 'clear' },
    ...before.executions.slice(1),
  ] };
  const delta = diffPlanOutput(before, after)!;
  expect(applyPlanOutputDelta(before, recorded(delta))).toEqual(after);
  expect(before.executions[0]?.token.generation).toBe(1);
  expect(applyPlanOutputDelta(undefined, delta)).toBeUndefined();
});

it('keeps arrays without unique row IDs exact, including null and empty values', () => {
  const before = { tags: ['normal'], overlapping: [{ id: 'same', x: 1 }, { id: 'same', x: 2 }], optional: 4 };
  const after = { tags: [], overlapping: [{ id: 'same', x: 4 }, { id: 'same', x: 3 }], optional: null };
  expect(applyPlanOutputDelta(before, recorded(diffPlanOutput(before, after)!))).toEqual(after);
});
