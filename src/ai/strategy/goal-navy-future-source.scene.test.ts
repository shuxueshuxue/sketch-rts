import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import { withGoalPlannerInput } from './goal-planner-input';
import { planGoals } from './goal-planner';

it('regresses the original zero-navy cold frame through a real shipyard and training dependency', () => {
  const original = gunzipSync(readFileSync(new URL('./fixtures/public-navy-zero-597.json.gz', import.meta.url))).toString();
  expect(createHash('sha256').update(original).digest('hex')).toBe('8d29faf796809089ee8856f34f49a2c613ed7f04eeaed2c7c549a4a65bf38103');
  const snapshot = JSON.parse(original);
  let memory = createAiPolicyMemory();
  const reports: unknown[] = [];
  let output: ReturnType<typeof planGoals> | undefined;
  withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
  }, () => withNavigationPhase('strategy-planning', () => {
    for (let think = 1; think <= 20; think++) {
      output = withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight', memory }, input => {
        const result = planGoals(input); memory.goalPlanning!.cache = result.cache;
        expect(input.work.receipt.used).toBeLessThanOrEqual(6144);
        reports.push({ think, work: input.work.receipt.used, plans: result.plans, ready: result.readyActions });
        return result;
      });
      memory = JSON.parse(JSON.stringify(memory));
      expect(JSON.stringify(snapshot)).toBe(original);
    }
  }));
  if (process.env.SKETCH_NAVY_SOURCE_EVIDENCE) writeFileSync(process.env.SKETCH_NAVY_SOURCE_EVIDENCE, JSON.stringify(reports));
  const plan = output!.plans.find(plan => plan.goal.effects.some(effect => effect.predicate.kind === 'hall-complete'))!;
  expect(plan).toBeDefined();
  const yard = plan.actions.find(node => node.declaration.kind === 'build' && node.declaration.executor.parameters.buildingKind === 'shipyard')!;
  const train = plan.actions.find(node => node.declaration.kind === 'train' && node.declaration.executor.parameters.unitKind === 'transport')!;
  const crossing = plan.actions.find(node => node.declaration.kind === 'transport-force')!;
  expect(yard).toBeDefined(); expect(train).toBeDefined(); expect(crossing).toBeDefined();
  const depends = (actionId: string, predecessorId: string, seen = new Set<string>()): boolean => {
    if (seen.has(actionId)) return false;
    seen.add(actionId);
    return plan.actions.find(node => node.id === actionId)!.dependsOnActionIds.some(id => id === predecessorId || depends(id, predecessorId, seen));
  };
  expect(depends(train.id, yard.id)).toBe(true);
  expect(depends(crossing.id, train.id)).toBe(true);
  expect(yard).toMatchObject({ state: 'ready', declaration: { precision: 'exact' } });
}, 600_000);
