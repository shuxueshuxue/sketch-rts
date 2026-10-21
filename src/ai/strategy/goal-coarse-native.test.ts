import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { discoverGoalActions } from './goal-provider-candidates';
import { withGoalPlannerInput } from './goal-planner-input';
import { goalFact } from './goal-facts';
import { goalPostCohorts } from './goal-post-cohorts';
import { planGoals } from './goal-planner';
import { projectGoalResources } from './goal-resource-ledger';
import type { GoalActionDeclaration } from './goal-planner-types';

// Original public puzzle 1 far snapshot, matching the archived f27/ac190
// frame. This is declaration/source validation, not puzzle acceptance.
const raw = gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-far.json.gz', import.meta.url)));
function original(): GameSnapshot {
  expect(createHash('sha256').update(raw).digest('hex')).toBe('4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78');
  return JSON.parse(raw.toString());
}
it('discovers coarse native dependencies from the original frame without requesting exact geometry', () => {
  const snapshot = original(), before = JSON.stringify(snapshot), memory = createAiPolicyMemory();
  withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
    () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight', memory }, input => {
      expect(input.context.precision).toBe('coarse');
      expect(input.context.planThroughTick! - snapshot.tick).toBe(12000);
      const pending = input.goals.flatMap(goal => goal.effects), seen = new Set<string>();
      const declarations: GoalActionDeclaration[] = [];
      for (let count = 0; pending.length && count < 100; count++) {
        const effect = pending.shift()!; if (seen.has(effect.id)) continue; seen.add(effect.id);
        for (const provider of input.providers) for (const action of discoverGoalActions(provider, effect, input.context).actions) {
          declarations.push(action); pending.push(...action.preconditions);
        }
      }
      expect(declarations.some(action => action.kind === 'clear-camp')).toBe(true);
      expect(declarations.some(action => action.kind === 'build')).toBe(true);
      expect(declarations.every(action => action.precision === 'coarse')).toBe(true);
      expect(memory.goalPlanning!.geometry!.entries).toEqual([]);
      expect(input.work.receipt.used).toBe(0);
    })));
  expect(JSON.stringify(snapshot)).toBe(before);
});
it('uses only a selected assembly post as a conditional origin and drops it after another move', () => {
  const snapshot = original(), memory = createAiPolicyMemory(), before = JSON.stringify(snapshot);
  withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight', memory, goals: [] }, input => {
    const refs = snapshot.units.filter(unit => unit.owner === 'planner' && unit.kind === 'footman')
      .map(unit => ({ kind: 'existing' as const, entityId: unit.id }));
    const from = { landId: 'land:2' as const, point: { x: 2784, y: 915 } };
    const at = { landId: 'land:2' as const, point: { x: 2976, y: 896 } };
    const proof = goalFact({ kind: 'force-at', at: from, cohort: refs, metric: 'combat-rating', minimum: 4, byTick: 12000 });
    const action: GoalActionDeclaration = { id: 'selected-assembly', kind: 'assemble', preconditions: [],
      effects: [{ fact: proof, operation: 'establish', at: 'finish' }], demands: [], flows: [], outputs: [], reasons: [],
      duration: { state: 'met', value: 100, factIds: [] }, cost: { state: 'met', value: [], factIds: [] },
      successProbability: { state: 'met', value: 1, factIds: [] },
      executor: { executor: 'goal.assemble', parameters: { cohort: refs, at: from } } };
    const effect = goalFact({ kind: 'force-at', at, cohort: refs, metric: 'combat-rating', minimum: 4, byTick: 12000 });
    const prefix = [{ action, startTick: 0, finishTick: 100 }];
    const options = goalPostCohorts(effect, input.context, prefix);
    expect(options).toHaveLength(1); expect(options[0]).toMatchObject({ from, availableTick: 100, preconditions: [proof] });
    expect(options[0]!.members.map(member => [member.reference, member.assessment.hp, member.assessment.attackDamage]))
      .toEqual(refs.map(reference => { const unit = snapshot.units.find(unit => unit.id === reference.entityId)!;
        return [reference, unit.hp, unit.attackDamage]; }));
    expect(goalPostCohorts(effect, input.context, [...prefix, { action: { ...action, id: 'later-transport', kind: 'transport-force', effects: [] },
      startTick: 100, finishTick: 200 }])).toEqual([]);
  });
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('uses the original opening balances for every prefix of the selected far-ship coarse chain', () => {
  const snapshot = original(), before = JSON.stringify(snapshot), memory = createAiPolicyMemory();
  withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight', memory }, input => {
    const { refineSelected: _refine, ...search } = input;
    const output = planGoals(search), plan = output.plans[0]!;
    expect(plan.actions.length).toBeGreaterThan(0);
    const actions = plan.actions.map(node => ({ action: node.declaration, startTick: node.startTick!, finishTick: node.finishTick! }));
    for (let length = 1; length <= actions.length; length++) {
      const projection = projectGoalResources({ epoch: snapshot.tick, initial: input.initialBalances, actions: actions.slice(0, length) });
      expect(projection.state).toBe('met');
      if (projection.state !== 'pending') expect(projection.deficits).toEqual([]);
    }
    const camp = plan.actions.find(node => node.declaration.kind === 'clear-camp');
    const worker = plan.actions.find(node => node.declaration.kind === 'transport-worker');
    expect(camp).toBeDefined(); expect(worker).toBeDefined();
    expect(worker!.startTick).toBeGreaterThanOrEqual(camp!.finishTick!);
    expect(worker!.declaration.preconditions.some(fact => fact.predicate.kind === 'site-safe')).toBe(true);
    expect(input.work.receipt.used).toBeLessThanOrEqual(6144);
  });
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('retains a selected exact loading assembly through frozen thinks even when no geometry entries were resident', () => {
  const snapshot = original(), before = JSON.stringify(snapshot);
  let memory = createAiPolicyMemory(), ready = false;
  for (let sequence = 1; sequence <= 8 && !ready; sequence++) {
    const output = withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight', memory }, input => {
      const result = planGoals(input); memory.goalPlanning!.cache = result.cache; return result;
    });
    ready = output.readyActions.some(row => row.action.declaration.kind === 'assemble' && row.action.declaration.precision === 'exact');
    expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(ready).toBe(true); expect(JSON.stringify(snapshot)).toBe(before);
}, 60_000);
