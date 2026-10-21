import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { buildStrategyDecision } from './decision';
import { defenseMethodProvider } from './defense-methods';
import type { AllocationMethodQuoteInput } from './allocation-types';

function frameInput(key: string, sourceId: string): AllocationMethodQuoteInput {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames[key];
  const snapshot = frame.snapshot as AllocationMethodQuoteInput['snapshot'];
  const decision = buildStrategyDecision(snapshot, frame.owner, { memory: frame.memory });
  const objective = decision.objectives.find(objective => objective.kind === 'DefendSite' && objective.target.entityId === sourceId)!;
  expect(objective).toBeDefined();
  const method = defenseMethodProvider.buildMethods({ snapshot, situation: decision.situation, objective,
    previous: null, executions: [], blocked: [] }).find(method => method.kind === 'evacuation')!;
  const worker = decision.situation.units.find(unit => unit.owner === frame.owner && unit.roles.includes('worker') && unit.location.kind === 'land')!;
  return { snapshot, situation: decision.situation, objective, method, unitIds: [worker.id], budgets: [], executions: [] };
}

it.each([
  ['gullIsland-p0-9930', 'building-p0-townHall-1166'],
  ['NaBoard-templeSpring-player-4-8095', 'building-player-4-townHall-1329'],
])('retains the real unknown refuge and requests safety facts in %s', (key, sourceId) => {
  const input = frameInput(key, sourceId), before = JSON.stringify(input);
  const condition = input.method.preconditions.find(condition => condition.reason.code === 'evacuation-shelter-safety-unknown');
  expect(condition?.status).toBe('unknown');
  expect(condition?.kind).toBe('shore-safe');
  const refuge = input.method.actions.at(-1)!.target;
  expect(refuge.entityId).not.toBe(sourceId);
  expect(condition?.demand).toMatchObject({ kind: 'workers', at: refuge });
  const materialized = defenseMethodProvider.materialize!(input);
  const quote = defenseMethodProvider.quote({ ...input, method: materialized });
  expect(quote.status).toBe('blocked');
  expect(quote.missingPreconditions.some(condition => condition.reason.code === 'evacuation-shelter-safety-unknown' && condition.status === 'unknown')).toBe(true);
  expect(quote.missingPreconditions.some(condition => condition.reason.code === 'no-reachable-evacuation-shelter')).toBe(false);
  expect(JSON.stringify(input)).toBe(before);
});

it('separates a known overrun refuge from uncertain incoming threats', () => {
  const input = frameInput('gullIsland-p0-9930', 'building-p0-townHall-1166');
  const situation = { ...input.situation, lands: input.situation.lands.map(land => ({ ...land,
    threats: land.threats.map(threat => threat.siteId === 'building-p0-townhall'
      ? { ...threat, arrivedStrength: 20, incomingStrength: 0, friendlyOnStationStrength: 0 } : threat) })) };
  const method = defenseMethodProvider.buildMethods({ ...input, situation, previous: null, blocked: [] })
    .find(method => method.kind === 'evacuation')!;
  expect(method.preconditions).toContainEqual(expect.objectContaining({ status: 'unmet',
    reason: expect.objectContaining({ code: 'evacuation-shelter-unsafe' }) }));
});

it('reports native physical unreachability separately from shelter safety', () => {
  const input = frameInput('gullIsland-p0-9930', 'building-p0-townHall-1166');
  const situation = { ...input.situation, lands: input.situation.lands.map(land => ({ ...land, threats: [] })) };
  const method = defenseMethodProvider.buildMethods({ ...input, situation, previous: null, blocked: [] })
    .find(method => method.kind === 'evacuation')!;
  const routed = { ...situation, units: situation.units.map(unit => ({ ...unit,
    arrivals: [{ targetId: method.actions.at(-1)!.id, arrival: { status: 'unreachable' as const,
      reason: { code: 'native-no-land-route' } } }] })) };
  const quote = defenseMethodProvider.quote({ ...input, situation: routed, method });
  expect(quote.status).toBe('blocked');
  expect(quote.missingPreconditions).toContainEqual(expect.objectContaining({ status: 'unmet', kind: 'route',
    reason: expect.objectContaining({ code: 'evacuation-shelter-route-unreachable' }) }));
  expect(quote.missingPreconditions.some(condition => condition.reason.code.includes('safety-unknown'))).toBe(false);
});

it('keeps an already bound refuge point while refreshing its unknown safety condition', () => {
  const input = frameInput('gullIsland-p0-9930', 'building-p0-townHall-1166');
  const original = input.method.actions.at(-1)!, target = { ...original.target,
    point: { x: original.target.point.x + 64, y: original.target.point.y } };
  const method = { ...input.method, actions: input.method.actions.map(action => action.id === original.id ? { ...action, target } : action) };
  const result = defenseMethodProvider.materialize!({ ...input, method });
  expect(result.actions.at(-1)!.target).toEqual(target);
  expect(result.preconditions.find(condition => condition.id.endsWith('/shelter'))?.demand).toMatchObject({ at: target });
});
