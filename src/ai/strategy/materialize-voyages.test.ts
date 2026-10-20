import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { AllocationMethodQuoteInput, ExecutableMethod } from './allocation-types';
import { buildStrategyDecision } from './decision';
import { materializeVoyages } from './materialize-voyages';

function sapphire(): AllocationMethodQuoteInput {
  const frame: { snapshot: GameSnapshot; memory: AiPolicyMemory; owner: string } = JSON.parse(gunzipSync(readFileSync(
    new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['Ne-sapphireArchipelago-player-4-17991'];
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  const decision = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
  const objective = decision.objectives.find(objective => objective.kind === 'ConquerIsland' && objective.target.entityId === 'gold-satellite-2')!;
  const id = `${objective.id}/method:test`, actionId = `${id}/deliver`;
  const method: ExecutableMethod = { id, objectiveId: objective.id, providerId: 'test', kind: 'staged-beachhead', preference: 0,
    preconditions: [], subgoals: [], demands: [], estimatedTicks: null, status: 'candidate', reasons: [], spends: [],
    actions: [{ id: actionId, executor: 'strategy.transport', intent: { kind: 'deliver-force' }, target: objective.target,
      demands: [], dependsOn: [], spendIds: [], completionEffects: [] }] };
  return { snapshot: frame.snapshot, situation: decision.situation, objective, method,
    unitIds: [3661, 5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`), budgets: [], executions: [] };
}

describe('candidate-specific native voyage materialization', () => {
  it('turns the sapphire four-unit shortfall into one actually packed future hull with checked shore points', () => {
    const input = sapphire(), actionId = input.method.actions[0]!.id, before = JSON.stringify(input);
    const plan = materializeVoyages(input, actionId);
    expect(plan.missing).toEqual([]);
    expect(plan.voyages).toHaveLength(1);
    expect(plan.voyages[0]!.ship.kind).toBe('production');
    expect(plan.voyages[0]!.unitIds).toEqual(input.unitIds.filter(id => !id.endsWith('-3661')).sort());
    expect(plan.voyages[0]!.landingGround.landId).toBe(input.objective.target.landId);
    expect(plan.voyages[0]!.departureGround.landId).not.toBe(input.objective.target.landId);
    expect(plan.spends.map(spend => spend.amountGold)).toEqual([240]);
    expect(plan.actions.map(action => action.intent.kind)).toEqual(['train-transport']);
    expect(plan.actions[0]!.demands).toContainEqual({ kind: 'production', buildingId: 'building-player-4-shipyard-1410', unitKind: 'transport', count: 1 });
    expect(JSON.stringify(input)).toBe(before);
    const cold: AllocationMethodQuoteInput = JSON.parse(JSON.stringify(input));
    setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(materializeVoyages(cold, actionId)).toEqual(plan);
  });

  it('derives the manifest from the supplied bundle instead of binding the frame\'s four specific IDs', () => {
    const input = sapphire();
    const subset = { ...input, unitIds: input.unitIds.slice(0, 3) };
    const plan = materializeVoyages(subset, input.method.actions[0]!.id);
    expect(plan.missing).toEqual([]);
    expect(plan.voyages.flatMap(voyage => voyage.unitIds)).toEqual(subset.unitIds.filter(id => !id.endsWith('-3661')).sort());
    expect(plan.voyages.flatMap(voyage => voyage.unitIds).every(id => subset.unitIds.includes(id))).toBe(true);
  });
});
