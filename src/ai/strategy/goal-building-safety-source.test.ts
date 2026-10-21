import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { declareGoalBuilding } from './goal-economy-actions';
import { withGoalPlannerInput } from './goal-planner-input';
import type { GoalActionNode } from './goal-planner-types';

// Exact original observer member, not a reconstructed scene: production
// 324670da / source 13b28abb, far think 498, absolute tick 7470.
const raw = readFileSync(new URL('./fixtures/goal-building-324-far-t7470.json.gz', import.meta.url));
const frame: { snapshot: GameSnapshot; memoryBefore: AiPolicyMemory;
  observation: { output: { plans: { actions: GoalActionNode[] }[] } } } = JSON.parse(gunzipSync(raw).toString());
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));

it('admits the original far hall construction window through 8189 instead of the whole-goal 19470', () => {
  expect(createHash('sha256').update(raw).digest('hex')).toBe('f7a7be73754d3a2159794bb447902af822733599d8fc75cbe21c1003f4eea0de');
  const snapshot = structuredClone(frame.snapshot), before = JSON.stringify(snapshot);
  const original = frame.observation.output.plans[0]!.actions.find(node => node.declaration.kind === 'build')!;
  const hall = original.declaration.effects.find(effect => effect.fact.predicate.kind === 'hall-complete')!.fact;
  if (hall.predicate.kind !== 'hall-complete') throw Error('recorded hall missing');
  const near = hall.predicate.at;
  const target = original.declaration.executor.parameters.at as { point: { x: number; y: number } };
  strict(() => withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight',
    memory: structuredClone(frame.memoryBefore), precision: 'exact' }, input => {
    const context = { ...input.context, planThroughTick: 19470 };
    const sites = context.grounding!.buildSites('townHall', near);
    expect(sites.state).toBe('met');
    if (sites.state !== 'met') throw Error('recorded site unavailable');
    const site = sites.candidates.find(site => site.at.point.x === target.point.x && site.at.point.y === target.point.y)!;
    const action = declareGoalBuilding({ buildingKind: 'townHall', at: site.at, byTick: 19470,
      worker: { ref: site.worker, ...(site.route?.predicate.kind === 'route' ? { from: site.route.predicate.from } : {}) },
      siteBinding: site }, context)!;
    expect(action.duration).toMatchObject({ state: 'met', value: 719 });
    const safety = action.preconditions.filter(fact => fact.predicate.kind === 'site-safe');
    expect(safety).toHaveLength(2);
    for (const fact of safety) {
      expect(fact.predicate).toMatchObject({ throughTick: 8189 });
      expect(action.preconditionWindows).toContainEqual({ factId: fact.id, through: 'finish' });
      expect(context.readFact(fact)).toMatchObject({ state: 'met', reason: { code: 'observed-safety-window-clear' } });
    }
    const oldSafety = original.declaration.preconditions.filter(fact => fact.predicate.kind === 'site-safe');
    expect(oldSafety).toHaveLength(2);
    for (const fact of oldSafety) {
      expect(fact.predicate).toMatchObject({ throughTick: 19470 });
      expect(context.readFact(fact)).toMatchObject({ state: 'pending', reason: { code: 'safety-window-support-pending' } });
    }
    expect(action.preconditions.every(fact => context.readFact(fact).state === 'met')).toBe(true);
    expect(input.work.receipt.used).toBe(0);
  }));
  expect(JSON.stringify(snapshot)).toBe(before);
});
