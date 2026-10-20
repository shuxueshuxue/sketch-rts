import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createUnit } from '../../shared/map';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { AllocationMethodQuoteInput, ExecutionAction } from './allocation-types';
import { conquestMethodProvider } from './conquest-methods';
import { buildStrategyDecision } from './decision';
import { materializeMiningWorkforce } from './materialize-mining-workforce';
import { miningCapacity } from './mining-capacity';
import { forecastMiningWorkforce } from './mining-forecast';
import { valuationWindow } from './utility';

function sapphire() {
  const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['Ne-sapphireArchipelago-player-4-17991'];
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  const decision = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
  const objective = decision.objectives.find(goal => goal.kind === 'ConquerIsland' && goal.target.entityId === 'gold-satellite-2')!;
  const method = conquestMethodProvider.buildMethods({ snapshot: frame.snapshot, situation: decision.situation, objective,
    previous: null, executions: [], blocked: [] })[0]!;
  const engineer = 'unit-player-4-worker-3';
  const input: AllocationMethodQuoteInput = { snapshot: frame.snapshot, situation: decision.situation, objective, method,
    budgets: [], executions: [], unitIds: [engineer] };
  const forecast = forecastMiningWorkforce({ snapshot: frame.snapshot, situation: decision.situation, mineId: objective.target.entityId!,
    hallReadyTicks: 1200, engineerId: engineer, explicitWorkerIds: [engineer], allowedUnitIds: [engineer],
    capacity: miningCapacity([]), window: valuationWindow(1200), availableGold: 300 });
  return { input, forecast, terminal: `${method.id}/start-mining`, build: `${method.id}/build-hall`, garrison: `${method.id}/garrison` };
}

describe('native-frame mining workforce plan materialization', () => {
  it('turns measured future staffing into explicit production and mining dependencies without fictional workers', () => {
    const { input, forecast, terminal, build, garrison } = sapphire();
    expect(forecast.training.length).toBeGreaterThan(0);
    const result = materializeMiningWorkforce(input, forecast, terminal, build, garrison);
    expect(result.missing).toEqual([]);
    const production = result.actions.filter(action => action.executor === 'strategy.train-worker');
    expect(production).toHaveLength(forecast.training.length);
    expect(production.every(action => action.unitIds?.length === 0 && action.production?.producer.kind === 'action-result'
      && action.production.producer.actionId === build)).toBe(true);
    expect(production.every(action => action.target.entityId === undefined)).toBe(true);
    expect(result.spends.reduce((sum, spend) => sum + spend.amountGold, 0)).toBe(forecast.training.length * 75);
    const nativeIds = new Set(input.snapshot.units.map(unit => unit.id));
    expect(result.actions.flatMap(action => action.unitIds ?? []).every(id => nativeIds.has(id) && input.unitIds.includes(id))).toBe(true);
    const finish = result.actions.find(action => action.id === terminal)!;
    const mining = result.actions.filter(action => action.executor === 'strategy.start-mining' && action.id !== terminal);
    expect(finish.dependsOn).toEqual(expect.arrayContaining(mining.map(action => action.id)));
    expect(mining.every(action => action.completionEffects.length === 0)).toBe(true);
    expect(finish.completionEffects).toEqual(input.objective.effects);
    const again = { ...input, method: { ...input.method, actions: [...input.method.actions.filter(action => action.id !== terminal), ...result.actions] } };
    expect(materializeMiningWorkforce(again, forecast, terminal, build, garrison)).toEqual(result);
    expect(materializeMiningWorkforce(JSON.parse(JSON.stringify(again)), forecast, terminal, build, garrison)).toEqual(result);
  });

  it('retains the paid action identity after a real born worker enters the candidate bundle', () => {
    const { input, forecast, terminal, build, garrison } = sapphire();
    const first = materializeMiningWorkforce(input, forecast, terminal, build, garrison);
    const production = first.actions.find(action => action.executor === 'strategy.train-worker')!;
    const born = createUnit('native-born-worker', input.situation.owner, 'worker', input.objective.target.point.x, input.objective.target.point.y);
    input.snapshot.units.push(born);
    const projected = forecast.workers.find(worker => worker.source === 'train-worker')!;
    const after = { ...forecast, workers: forecast.workers.map(worker => worker === projected
      ? { ...worker, unitId: born.id, source: 'surplus' as const, producerId: null, conditional: false } : worker),
      training: forecast.training.filter(training => training.id !== projected.unitId) };
    const execution: ExecutionAction = { token: { actionId: production.id, generation: 1 }, objectiveId: input.objective.id,
      methodId: input.method.id, executor: production.executor, intent: production.intent, target: production.target,
      dependsOn: production.dependsOn, completionEffects: [], status: 'complete', phase: 'worker-trained',
      sinceTick: input.snapshot.tick, lastProgressTick: input.snapshot.tick, state: { createdUnitId: born.id },
      ...(production.production ? { production: production.production } : {}) };
    const materialized = { ...input, unitIds: [...input.unitIds, born.id], executions: [execution],
      method: { ...input.method, actions: [...input.method.actions.filter(action => action.id !== terminal), ...first.actions] } };
    const result = materializeMiningWorkforce(materialized, after, terminal, build, garrison);
    expect(result.missing).toEqual([]);
    expect(result.actions.find(action => action.id === production.id)).toEqual(production);
    expect(result.actions.filter(action => action.executor === 'strategy.train-worker')).toHaveLength(first.spends.length);
    expect(result.actions.find(action => action.id === `${input.method.id}/mine:${born.id}`)?.unitIds).toEqual([born.id]);
    const unpaid = result.actions.filter(action => action.executor === 'strategy.train-worker' && action.id !== production.id);
    expect(unpaid.every(action => first.actions.some(previous => previous.id === action.id))).toBe(true);
  });

  it('does not silently recruit an ungranted forecast worker or forget active production', () => {
    const { input, forecast, terminal, build, garrison } = sapphire();
    const ungranted = materializeMiningWorkforce({ ...input, unitIds: [] }, forecast, terminal, build, garrison);
    expect(ungranted.missing.some(condition => condition.reason.code === 'forecast-worker-not-in-granted-bundle')).toBe(true);
    const first = materializeMiningWorkforce(input, forecast, terminal, build, garrison);
    const production = first.actions.find(action => action.executor === 'strategy.train-worker')!;
    const execution: ExecutionAction = { token: { actionId: production.id, generation: 1 }, objectiveId: input.objective.id,
      methodId: input.method.id, executor: production.executor, intent: production.intent, target: production.target,
      dependsOn: [], completionEffects: [], status: 'active', phase: 'training', sinceTick: input.snapshot.tick,
      lastProgressTick: input.snapshot.tick, state: {} };
    const changed = { ...input, executions: [execution], method: { ...input.method,
      actions: [...input.method.actions.filter(action => action.id !== terminal), ...first.actions] } };
    const result = materializeMiningWorkforce(changed, { ...forecast, workers: [], training: [] }, terminal, build, garrison);
    expect(result.missing.some(condition => condition.reason.code === 'forecast-omits-committed-worker-production')).toBe(true);
    expect(result.actions.some(action => action.id === production.id)).toBe(true);
  });
});
