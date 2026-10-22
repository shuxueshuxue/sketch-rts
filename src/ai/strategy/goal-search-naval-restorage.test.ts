import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { StrategyAllocationMemory } from './allocation-types';
import type { GoalActionKind } from './goal-planner-types';
import { readGoalIntent, storeGoalMethod } from './goal-authority-references';
import { reconcileGoalCapitalReceipts } from './goal-capital-receipts';
import { goalGlobalStepKey, type GoalGrounding } from './goal-search-format';
import { migrateGoalAuthoritySelectors, type GoalPriorDefinition } from './goal-search-migration';

function original() {
  const raw = readFileSync(new URL('./fixtures/goal-authority-d888-near-t4695.json.gz', import.meta.url));
  const provenance = JSON.parse(readFileSync(new URL('./fixtures/goal-authority-d888-near-t4695.provenance.json', import.meta.url), 'utf8'));
  expect(createHash('sha256').update(raw).digest('hex')).toBe(provenance.projectionCompressedSha256);
  const plain = gunzipSync(raw);
  expect(createHash('sha256').update(plain).digest('hex')).toBe(provenance.projectionJsonSha256);
  return JSON.parse(plain.toString()) as { snapshot: GameSnapshot; authority: StrategyAllocationMemory };
}

// Domain selector fields from the auditor's original native-authority probe.
// The saved execution/command IDs are never used as grounding identity.
function select(row: GoalPriorDefinition): string {
  const { kind, parameters } = row.content as { kind: GoalActionKind; parameters: Record<string, unknown> };
  const fields: Partial<Record<GoalActionKind, string[]>> = {
    build: ['buildingKind', 'at', 'worker'], train: ['producer', 'unitKind', 'count'],
    assemble: ['at', 'cohort'], 'position-transport': ['transport', 'at'],
    'transport-force': ['transport', 'cohort', 'at', 'landing'],
    'transport-worker': ['transport', 'cohort', 'at', 'landing'],
    'clear-camp': ['campId', 'cohort'], 'clear-shore': ['at', 'threatIds', 'cohort'],
    defend: ['at', 'protectedSite', 'cohort', 'throughTick'], evacuate: ['shelter', 'cohort'],
    'destroy-target': ['target', 'cohort'], 'engage-units': ['target', 'cohort', 'threatIds'],
    'wait-income': ['minimumGold'],
    'hold-position': ['target', 'cohort', 'garrisonMineId', 'garrisonAt', 'throughTick'],
  };
  if (!row.goalId || !fields[kind]) throw Error('Missing fixture domain selector');
  const grounding: Record<string, GoalGrounding[string]> = {};
  const flatten = (value: unknown, path: string): void => {
    if (value === undefined) return;
    if (Array.isArray(value)) [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      .forEach((item, index) => flatten(item, `${path}.${index}`));
    else if (value && typeof value === 'object') for (const key of Object.keys(value).sort()) {
      if (kind === 'build' && path === 'at' && key === 'entityId') continue;
      flatten((value as Record<string, unknown>)[key], `${path}.${key}`);
    } else grounding[path] = value as GoalGrounding[string];
  };
  for (const field of fields[kind]!) flatten(parameters[field], field);
  return goalGlobalStepKey(row.goalId, { provider: ['build', 'train', 'wait-income'].includes(kind) ? 'goal:economy' : 'goal:naval-and-defense', kind, grounding });
}

it('re-stores the original near4695 hold after migration without changing intent, versions, payment or execution rights', () => {
  const fixture = original(), before = JSON.stringify(fixture), source = fixture.authority;
  let current = migrateGoalAuthoritySelectors(source, undefined, select);
  const initial = structuredClone(current), version = current.goalReferences!.nextVersion;
  expect(version).toBe(89);
  expect(Object.values(current.budgets).filter(budget => budget.paidGold === 400)).toHaveLength(1);
  for (let i = 0; i < 3; i++) {
    current = JSON.parse(JSON.stringify(current));
    for (const method of Object.values(current.methods).filter(method => method.kind === 'goal-plan')) {
      const input = JSON.stringify(current), packed = storeGoalMethod(current, method);
      expect(JSON.stringify(current)).toBe(input);
      expect(packed.method).toEqual(method);
      expect(packed.memory.goalReferences!.nextVersion).toBe(version);
      expect(Object.keys(packed.memory.goalReferences!.entries)).toEqual(Object.keys(initial.goalReferences!.entries));
      method.actions.forEach((action, index) => {
        if (action.intent.kind !== 'goal-action') throw Error('Expected goal method');
        const next = packed.method.actions[index]!.intent;
        if (next.kind !== 'goal-action') throw Error('Expected goal intent');
        const identity = readGoalIntent(current, action.intent).declarationId;
        expect(identity).toMatch(/^goal-step:1:/);
        expect(readGoalIntent(packed.memory, next).declarationId).toBe(identity);
      });
      current = packed.memory;
    }
    current = reconcileGoalCapitalReceipts(current, fixture.snapshot);
    expect(current.budgets).toEqual(initial.budgets);
    expect(current.executions).toEqual(initial.executions);
    expect(current.issuedCommands).toEqual(initial.issuedCommands);
    expect(current.leases).toEqual(initial.leases); expect(current.assignments).toEqual(initial.assignments);
  }
  expect(JSON.stringify(fixture)).toBe(before);
});

it('keeps the original naval definition without a selector on the unchanged path', () => {
  const { authority } = original(), before = JSON.stringify(authority);
  const method = Object.values(authority.methods).find(method => method.actions.some(action =>
    action.intent.kind === 'goal-action' && action.intent.actionKind === 'hold-position'))!;
  const packed = storeGoalMethod(authority, method);
  expect(packed.method).toEqual(method);
  expect(packed.memory.goalReferences).toEqual(authority.goalReferences);
  expect(JSON.stringify(authority)).toBe(before);
});

it('rejects a malformed, cross-goal or wrong-kind selector before changing stored authority', () => {
  const { authority } = original();
  const method = Object.values(authority.methods).find(method => method.actions.some(action =>
    action.intent.kind === 'goal-action' && action.intent.actionKind === 'hold-position'))!;
  const action = method.actions[0]!;
  if (action.intent.kind !== 'goal-action') throw Error('Expected hold');
  const intent = action.intent, before = JSON.stringify(authority);
  for (const declarationId of ['goal-step:1:invalid',
    goalGlobalStepKey('another-goal', { provider: 'goal:naval-and-defense', kind: 'hold-position', grounding: {} }),
    goalGlobalStepKey(intent.goalId, { provider: 'goal:naval-and-defense', kind: 'defend', grounding: {} })]) {
    expect(() => storeGoalMethod(authority, { ...method, actions: [{ ...action, intent: { ...intent, declarationId } }] })).toThrow();
    expect(JSON.stringify(authority)).toBe(before);
  }
});
