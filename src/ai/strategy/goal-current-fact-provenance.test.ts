import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { planGoals } from './goal-planner';
import { withGoalPlannerInput } from './goal-planner-input';
import { projectGoalResources } from './goal-resource-ledger';

it('keeps the original near hull fact as current evidence while a later return remains after the first army crossing', () => {
  const raw = gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-near.json.gz', import.meta.url)));
  expect(createHash('sha256').update(raw).digest('hex')).toBe('e457c849ed51985dcfc184fc02101edc09fd274788b782f26a563fe455a39cea');
  const snapshot: GameSnapshot = JSON.parse(raw.toString()), before = JSON.stringify(snapshot), memory = createAiPolicyMemory();
  const output = withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
    () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight', memory }, input => {
      const output = planGoals(input), plan = output.plans[0]!;
      expect(projectGoalResources({ epoch: snapshot.tick, initial: input.initialBalances, actions: plan.actions.map(node => ({
        action: node.declaration, startTick: node.startTick!, finishTick: node.finishTick! })) }).state).toBe('met');
      return output;
    })));
  const plan = output.plans[0]!, transport = plan.actions.find(node => node.declaration.kind === 'transport-force')!;
  const returned = plan.actions.find(node => node.declaration.kind === 'position-transport')!;
  expect(transport).toBeDefined(); expect(returned).toBeDefined();
  expect(returned.startTick).toBeGreaterThanOrEqual(transport.finishTick!);
  expect(returned.dependsOnActionIds).toContain(transport.id);
  const dock = plan.facts.find(node => node.observation.fact.predicate.kind === 'transport-at'
    && node.observation.fact.predicate.at.point.x === 1664 && node.observation.fact.predicate.at.point.y === 768)!;
  expect(dock.observation).toMatchObject({ state: 'met', reason: { code: 'native-transport-pose' } });
  expect(dock.producerActionIds).toEqual([]);
  // Same ancestor construction as the public plan checker, including every
  // fact edge as well as the explicit action dependencies.
  const predecessors = new Map<string, Set<string>>();
  const link = (from: string, to: string) => { const set = predecessors.get(to) ?? new Set<string>(); set.add(from); predecessors.set(to, set); };
  for (const action of plan.actions) for (const parent of action.dependsOnActionIds) link(parent, action.id);
  for (const edge of plan.edges) link(edge.from, edge.to);
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (seen.has(to)) return false;
    seen.add(to);
    return [...(predecessors.get(to) ?? [])].some(id => id === from || reaches(from, id, seen));
  };
  expect(plan.actions.filter(node => node.declaration.kind === 'position-transport' && reaches(node.id, transport.id))).toHaveLength(0);
  expect(reaches(transport.id, returned.id)).toBe(true);
  expect(plan.actions.filter(node => node.declaration.kind === 'transport-worker').some(node => reaches(returned.id, node.id))).toBe(true);
  expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
  expect(JSON.stringify(snapshot)).toBe(before);
});
