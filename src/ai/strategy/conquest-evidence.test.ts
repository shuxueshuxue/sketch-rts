import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { buildStrategyDecision } from './decision';
import { conquestMethodProvider } from './conquest-methods';

it('preserves materialized prerequisite identity and numeric evidence in a blocked quote', () => {
  const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString())
    .frames['Ne-sapphireArchipelago-player-4-17991'];
  const decision = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
  const objective = decision.objectives.find(goal => goal.kind === 'ConquerIsland' && goal.target.entityId === 'gold-satellite-2')!;
  const method = conquestMethodProvider.buildMethods({ snapshot: frame.snapshot, situation: decision.situation,
    objective, previous: null, executions: [], blocked: [] })[0]!;
  const reason = { code: 'exact-member-route-unpublished', factIds: ['unit-player-4-worker-3', 'gold-satellite-2'],
    values: { requestedTick: frame.snapshot.tick, routeKnown: false } };
  const condition = { id: 'materialized-route-evidence', kind: 'route' as const, status: 'unknown' as const,
    reason, demand: null, subgoalIds: [] };
  const result = conquestMethodProvider.quote({ snapshot: frame.snapshot, situation: decision.situation, objective,
    method: { ...method, preconditions: [condition] }, unitIds: [], budgets: [], executions: [] });
  expect(result.status).toBe('blocked');
  expect(result.missingPreconditions.find(value => value.id === condition.id)?.reason).toEqual(reason);
});
