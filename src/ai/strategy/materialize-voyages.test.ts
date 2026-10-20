import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createUnit } from '../../shared/map';
import { boardUnit } from '../../shared/decks';
import { shipLaunchPose, shipLaunchPrototype } from '../../shared/ship-launch';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { AllocationMethodQuoteInput, ExecutableMethod, ExecutionAction, ExecutionState } from './allocation-types';
import type { FixedVoyage } from './arrivals';
import type { Arrival, Target } from './types';
import { buildStrategyDecision } from './decision';
import { materializeVoyages } from './materialize-voyages';
import { allocatedMemberArrival } from './planned-voyage-arrival';
import { landIdAt, regionIndex } from './regions';
import { nativeVoyageBerth } from './voyage-berth';

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

function committed() {
  const initial = sapphire(), actionId = initial.method.actions[0]!.id, plan = materializeVoyages(initial, actionId);
  const voyage = plan.voyages[0]!, production = plan.actions[0]!;
  const method = { ...initial.method, voyagePlans: plan.voyages, actions: [...initial.method.actions, ...plan.actions], spends: plan.spends };
  const execute = (action: ExecutableMethod['actions'][number], status: ExecutionAction['status'], phase: string, state: ExecutionState): ExecutionAction => ({
    token: { actionId: action.id, generation: 1 }, objectiveId: method.objectiveId, methodId: method.id,
    executor: action.executor, intent: action.intent, target: action.target, dependsOn: action.dependsOn, completionEffects: action.completionEffects,
    ...(action.production ? { production: action.production } : {}), status, phase, state,
    sinceTick: initial.snapshot.tick - 10, lastProgressTick: initial.snapshot.tick });
  const producer = execute(production, 'active', 'producing', { observedProduction: true });
  return { input: { ...initial, method, executions: [producer] }, actionId, voyage, producer, execute };
}

function launched() {
  const context = committed(), boat = createUnit('observed-birth', context.input.situation.owner, 'transport',
    context.voyage.departure.point.x, context.voyage.departure.point.y);
  context.input.snapshot.units.push(boat);
  const crew = context.input.snapshot.units.filter(unit => context.voyage.unitIds.includes(unit.id));
  for (const unit of crew) expect(boardUnit(boat, unit, context.input.snapshot.units)).toBe(true);
  const producer = { ...context.producer, status: 'complete' as const, state: { createdShipId: boat.id } };
  const travel = context.execute(context.input.method.actions[0]!, 'active', 'parallel-voyages', {
    voyages: { [context.voyage.id]: { phase: 'sailing', status: 'active' } }, requiredVoyageIds: [context.voyage.id] });
  const query = vi.fn((_unit: GameSnapshot['units'][number], _target: Target, _voyage: FixedVoyage): Arrival => ({
    status: 'reachable', ticks: 500, landTicks: 20,
    crossings: [{ ...context.voyage.crossing, requiresNewShip: false, shipId: boat.id, sailingTicks: 400 }], evidence: [] }));
  const input: AllocationMethodQuoteInput = { ...context.input, unitIds: [...context.input.unitIds, boat.id],
    executions: [producer, travel], fixedVoyageArrival: query };
  return { ...context, input, boat, crew, query, travel };
}

function nativeBerthInput() {
  const frame: { snapshot: GameSnapshot; memory: AiPolicyMemory; owner: string } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const { snapshot } = frame;
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const decision = buildStrategyDecision(snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
  const objective = decision.objectives.find(objective => objective.kind === 'ConquerIsland' && objective.target.entityId === 'gold-satellite-3')!;
  const regions = regionIndex(snapshot.map), candidate = regions.shores.find(shore => shore.water.x === 1648 && shore.water.y === 2480)!;
  const yard = snapshot.buildings.find(building => building.owner === frame.owner && building.kind === 'shipyard')!;
  const hull = shipLaunchPrototype(yard, 'transport'), launch = shipLaunchPose(snapshot, yard, hull)!;
  hull.x = launch.x; hull.y = launch.y;
  hull.sailing = { heading: launch.heading, speed: 0, load: 0, balance: 0 };
  const passenger = snapshot.units.find(unit => unit.owner === frame.owner && unit.kind === 'worker'
    && !unit.deck && !unit.cabin && landIdAt(snapshot.map, unit) === candidate.landId)!;
  const departure = nativeVoyageBerth(snapshot, passenger, hull, candidate);
  let landing: ReturnType<typeof nativeVoyageBerth> | undefined;
  for (const shore of regions.shores) {
    if (shore.landId !== objective.target.landId || shore.seaId !== candidate.seaId) continue;
    const berth = nativeVoyageBerth(snapshot, passenger, hull, shore);
    if (berth.status === 'known') { landing = berth; break; }
  }
  if (departure.status !== 'known' || landing?.status !== 'known') throw new Error('Expected native berths in the real 4180 frame');
  const crossing = { seaId: candidate.seaId, shipId: null, productionBuildingId: yard.id, requiresNewShip: true,
    departure: departure.shore.water, departureGround: departure.shore.ground, departureHeading: departure.heading,
    landing: landing.shore.water, landingGround: landing.shore.ground, landingHeading: landing.heading,
    waitTicks: 0, boardingTicks: 0, sailingTicks: 100, unloadingTicks: 0 };
  const id = `${objective.id}/method:native-points`, actionId = `${id}/deliver`;
  const method: ExecutableMethod = { id, objectiveId: objective.id, providerId: 'test', kind: 'staged-beachhead', preference: 0,
    preconditions: [], subgoals: [], demands: [], estimatedTicks: 100, status: 'candidate', reasons: [], spends: [],
    actions: [{ id: actionId, executor: 'strategy.transport', intent: { kind: 'deliver-workers' }, target: objective.target,
      demands: [], dependsOn: [], spendIds: [], completionEffects: [] }] };
  // Inject an already quoted numerical row: this checks the materialization
  // contract, not a new claim about native travel time or allocator behavior.
  const arrival: Arrival = { status: 'conditional', ticks: 100, landTicks: 0, crossings: [crossing], unmet: [], evidence: [] };
  const situation = { ...decision.situation, units: decision.situation.units.map(unit => unit.id === passenger.id
    ? { ...unit, arrivals: [{ targetId: actionId, arrival }] } : unit) };
  const input: AllocationMethodQuoteInput = { snapshot, situation, objective, method, unitIds: [passenger.id], budgets: [], executions: [] };
  return { input, actionId, crossing };
}

describe('candidate-specific native voyage materialization', () => {
  it('preserves explicit native water poses and land points in the real 4180 geometry', () => {
    const { input, actionId, crossing } = nativeBerthInput(), before = JSON.stringify(input);
    const plan = materializeVoyages(input, actionId);
    expect(plan.missing).toEqual([]); expect(plan.voyages).toHaveLength(1);
    expect(plan.voyages[0]).toMatchObject({ departure: { point: crossing.departure }, destination: { point: crossing.landing },
      departureGround: { point: crossing.departureGround }, landingGround: { point: crossing.landingGround }, crossing });
    const cold: AllocationMethodQuoteInput = JSON.parse(JSON.stringify(input));
    expect(materializeVoyages(cold, actionId)).toEqual(plan);
    expect(JSON.stringify(input)).toBe(before);
    const turned = { ...input, situation: { ...input.situation, units: input.situation.units.map(unit => input.unitIds.includes(unit.id)
      ? { ...unit, arrivals: [{ targetId: actionId, arrival: { status: 'conditional' as const, ticks: 100, landTicks: 0,
        crossings: [{ ...crossing, departureHeading: crossing.departureHeading + .1 }], unmet: [], evidence: [] } }] } : unit) } };
    const refreshed = materializeVoyages(turned, actionId);
    expect(refreshed.spends).toEqual(plan.spends);
    expect(refreshed.voyages.map(voyage => voyage.id)).toEqual(plan.voyages.map(voyage => voyage.id));
  });

  it('rejects an explicit land point on the wrong island instead of repairing its geometry', () => {
    const { input, actionId, crossing } = nativeBerthInput();
    const situation = { ...input.situation, units: input.situation.units.map(unit => input.unitIds.includes(unit.id)
      ? { ...unit, arrivals: [{ targetId: actionId, arrival: { status: 'conditional' as const, ticks: 100, landTicks: 0,
        crossings: [{ ...crossing, departureGround: crossing.landingGround }], unmet: [], evidence: [] } }] } : unit) };
    const plan = materializeVoyages({ ...input, situation }, actionId);
    expect(plan.voyages).toEqual([]);
    expect(plan.missing.some(condition => condition.reason.code === 'crossing-ground-pair-unverified')).toBe(true);
  });

  it('keeps bound native pose fields when refreshing a retained voyage through an older arrival row', () => {
    const { input, actionId, voyage } = launched();
    const crossing = { ...voyage.crossing, departureGround: voyage.departureGround.point, departureHeading: .2, landingHeading: .7 };
    const plan = materializeVoyages({ ...input, method: { ...input.method, voyagePlans: [{ ...voyage, crossing }] } }, actionId);
    expect(plan.missing).toEqual([]);
    expect(plan.voyages[0]!.crossing).toMatchObject({ departureGround: voyage.departureGround.point, departureHeading: .2, landingHeading: .7 });
  });

  it('keeps the original paid producer and spend while a retained hull has not been born', () => {
    const { input, actionId, voyage } = committed(), before = JSON.stringify(input), plan = materializeVoyages(input, actionId);
    expect(plan.voyages).toEqual([voyage]);
    expect(plan.actions).toEqual(input.method.actions.filter(action => action.executor === 'strategy.train-transport'));
    expect(plan.spends).toEqual(input.method.spends);
    expect(plan.latestArrivalTicks).toBeNull();
    expect(new Set(plan.missing.map(condition => condition.reason.code))).toEqual(new Set(['fixed-voyage-production-pending']));
    expect(materializeVoyages(JSON.parse(JSON.stringify(input)), actionId)).toEqual(plan);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('refreshes aboard passengers on the observed born hull instead of another fast crossing', () => {
    const { input, actionId, voyage, query, boat } = launched();
    const alternative = createUnit('faster-global-boat', input.situation.owner, 'transport', boat.x, boat.y);
    input.snapshot.units.push(alternative);
    const request = { ...input, unitIds: [...input.unitIds, alternative.id], method: { ...input.method, estimatedTicks: 1 } };
    const before = JSON.stringify(request), plan = materializeVoyages(request, actionId);
    expect(plan.missing).toEqual([]); expect(plan.latestArrivalTicks).toBe(500);
    expect(plan.voyages).toHaveLength(1);
    expect(plan.voyages[0]).toMatchObject({ id: voyage.id, ship: voyage.ship, unitIds: voyage.unitIds,
      departure: voyage.departure, destination: voyage.destination, departureGround: voyage.departureGround, landingGround: voyage.landingGround });
    expect(query).toHaveBeenCalledTimes(voyage.unitIds.length);
    for (const [, , fixed] of query.mock.calls) expect(fixed).toMatchObject({ shipId: boat.id, departure: voyage.departure.point,
      landing: voyage.destination.point, phase: 'sailing' });
    expect(allocatedMemberArrival(request, request.snapshot.units.find(unit => unit.id === voyage.unitIds[0])!,
      request.objective.target, request.objective.target.entityId!)).toMatchObject({ ticks: 500 });
    const cold = { ...JSON.parse(JSON.stringify(request)), fixedVoyageArrival: query };
    expect(materializeVoyages(cold, actionId)).toEqual(plan);
    expect(JSON.stringify(request)).toBe(before);
  });

  it('retains already landed members until the same partial-unload voyage completes', () => {
    const { input, actionId, voyage, crew, travel, query } = launched();
    const first = crew[0]!;
    delete first.deck; delete first.cabin;
    Object.assign(first, voyage.landingGround.point);
    const partial = { ...input, executions: [input.executions[0]!, { ...travel, state: { voyages: {
      [voyage.id]: { phase: 'unloading', status: 'active', landedIds: [first.id], loadedIds: voyage.unitIds } } } }] };
    const plan = materializeVoyages(partial, actionId);
    expect(plan.missing).toEqual([]); expect(plan.voyages[0]!.unitIds).toEqual(voyage.unitIds);
    expect(query.mock.calls.every(([, , fixed]) => fixed.phase === 'unloading')).toBe(true);
  });

  it('keeps an unknown fixed route explicit and cannot silently drop a removed member to reselect a ship', () => {
    const { input, actionId, voyage } = launched();
    const { fixedVoyageArrival: _query, ...withoutQuery } = input;
    const blocked = materializeVoyages(withoutQuery, actionId);
    expect(blocked.latestArrivalTicks).toBeNull();
    expect(blocked.missing.some(condition => condition.reason.code === 'fixed-voyage-query-unavailable')).toBe(true);
    const removed = materializeVoyages({ ...input, unitIds: input.unitIds.filter(id => id !== voyage.unitIds[0]) }, actionId);
    expect(removed.missing.some(condition => condition.reason.code === 'fixed-voyage-manifest-no-longer-granted')).toBe(true);
    expect(removed.voyages).toEqual([]);
    expect(removed.spends).toEqual(input.method.spends);
  });

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
