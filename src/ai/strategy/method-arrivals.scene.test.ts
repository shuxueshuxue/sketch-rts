import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { moverDistanceField, setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { buildStrategyDecision } from './decision';
import { defenseMethodProvider } from './defense-methods';
import { conquestMethodProvider } from './conquest-methods';
import { assessAllocatedForce } from './allocated-force';
import { withAllocationMethodArrivals } from './method-arrivals';
import { unitArrival, unitArrivalFacts } from './unit-arrivals';
import { OBSERVATION_BYTE_LIMIT } from './observation-memory';

function frame() {
  const input: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['gullIsland-p0-9930'];
  setBuildingBodies(input.snapshot.map, standingBodies(input.snapshot));
  const decision = buildStrategyDecision(input.snapshot, input.owner, { memory: input.memory }, undefined, undefined, Infinity);
  const objective = decision.objectives.find(goal => goal.id === 'DefendSite:p0:building-p0-townHall-1166')!;
  const methods = defenseMethodProvider.buildMethods({ ...input, situation: decision.situation, objective,
    previous: null, executions: [], blocked: [] });
  return { ...input, situation: decision.situation, objective, methods };
}
const crew = [1687, 1720, 2015, 2047, 2066, 2094].map(id => `unit-p0-emberRavager-${id}`);

describe('actual action-post ETA in the E01 home raid', () => {
  it('quotes the recall post rather than borrowing an ETA to the hall centre', () => {
    const input = frame(), method = input.methods.find(method => method.kind === 'main-army-recall')!, action = method.actions.at(-1)!;
    expect(action.target.point).not.toEqual(input.objective.target.point);
    const before = defenseMethodProvider.quote({ ...input, method, unitIds: crew, budgets: [], executions: [] });
    expect(before.reason.code).toBe('response-arrival-unknown');
    const situation = withAllocationMethodArrivals(input.snapshot, input.owner, input.memory, input.situation, input.methods, Infinity);
    for (const id of crew) {
      const unit = situation.units.find(unit => unit.id === id)!, raw = input.snapshot.units.find(unit => unit.id === id)!;
      const arrival = unitArrival(unit, action.id)!;
      expect(arrival.status).toBe('reachable');
      const native = moverDistanceField(input.snapshot.map, action.target.point, 'land')!;
      expect('ticks' in arrival && arrival.ticks).toBe(Math.ceil(native.cost(raw)! / raw.speed * 20));
      expect(unitArrivalFacts(unit)).toBeDefined();
    }
    const quote = defenseMethodProvider.quote({ ...input, situation, method, unitIds: crew, budgets: [], executions: [] });
    expect(quote.reason.code).not.toBe('response-arrival-unknown');
    expect(quote.force?.enRouteUnitIds).toEqual(crew);
    expect(quote.force?.effectiveForce).toBeGreaterThan(0);
    expect(quote.force!.effectiveForce).toBeLessThan(assessAllocatedForce(input.owner,
      input.snapshot.units.filter(unit => crew.includes(unit.id)), { metric: 'field-strength', requiredForce: 0 }).force);
  });

  it('keeps an unfinished post unknown even when a process cache already contains its complete field', () => {
    const input = frame(), method = input.methods.find(method => method.kind === 'main-army-recall')!, action = method.actions.at(-1)!;
    moverDistanceField(input.snapshot.map, action.target.point, 'land');
    const memory = structuredClone(input.memory);
    // No publication state for action targets exists yet in either save.
    const a = withAllocationMethodArrivals(input.snapshot, input.owner, input.memory, input.situation, [method], 0);
    const b = withAllocationMethodArrivals(input.snapshot, input.owner, memory, input.situation, [...[method]].reverse(), 0);
    expect(unitArrival(a.units.find(unit => unit.id === crew[0])!, action.id)).toMatchObject({ status: 'unknown' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(input.memory.strategy)).toBe(JSON.stringify(memory.strategy));
  });

  it('resumes serialized progress without reading the compatibility arrays on the numerical path', () => {
    const input = frame();
    for (const unit of input.situation.units) Object.defineProperty(unit, 'arrivals', { configurable: true,
      get() { throw new Error('Control materialized an explanatory arrival array'); } });
    const a = withAllocationMethodArrivals(input.snapshot, input.owner, input.memory, input.situation, input.methods, Infinity);
    for (const id of crew) expect(unitArrivalFacts(a.units.find(unit => unit.id === id)!)).toBeDefined();
    const forkMemory = JSON.parse(JSON.stringify(input.memory));
    const restored = structuredClone(input.snapshot); setBuildingBodies(restored.map, standingBodies(restored));
    const b = withAllocationMethodArrivals(restored, input.owner, forkMemory, input.situation, [...input.methods].reverse(), Infinity);
    for (const method of input.methods) for (const id of crew) expect(unitArrival(a.units.find(unit => unit.id === id)!, method.actions.at(-1)!.id))
      .toEqual(unitArrival(b.units.find(unit => unit.id === id)!, method.actions.at(-1)!.id));
    expect(JSON.stringify(input.memory.strategy)).toBe(JSON.stringify(forkMemory.strategy));
    expect(new TextEncoder().encode(JSON.stringify(input.memory.strategy)).length).toBeLessThanOrEqual(OBSERVATION_BYTE_LIMIT);
  });

  it('publishes the same Ne mine fact under its exact transport actions and entity before materialization', () => {
    const input: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
      new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['Ne-sapphireArchipelago-player-4-17991'];
    setBuildingBodies(input.snapshot.map, standingBodies(input.snapshot));
    const decision = buildStrategyDecision(input.snapshot, input.owner, { memory: input.memory }, undefined, undefined, Infinity);
    const objective = decision.objectives.find(goal => goal.id === 'ConquerIsland:player-4:gold-satellite-2')!;
    const methods = conquestMethodProvider.buildMethods({ ...input, situation: decision.situation, objective,
      previous: null, executions: [], blocked: [] });
    expect(methods.flatMap(method => method.actions).some(action => action.executor === 'strategy.assemble')).toBe(false);
    const situation = withAllocationMethodArrivals(input.snapshot, input.owner, input.memory, decision.situation, methods, Infinity);
    const unitIds = [3661, 5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`);
    unitIds.push('unit-player-4-worker-3');
    for (const id of unitIds) {
      const unit = situation.units.find(unit => unit.id === id)!;
      const arrival = unitArrival(unit, objective.target.entityId!)!;
      expect(arrival && 'ticks' in arrival).toBe(true);
      for (const action of methods.flatMap(method => method.actions).filter(action =>
        action.target.point.x === objective.target.point.x && action.target.point.y === objective.target.point.y))
        expect(unitArrival(unit, action.id)).toBe(arrival);
    }
    const landed = situation.units.find(unit => unit.id === unitIds[0])!, actor = input.snapshot.units.find(unit => unit.id === landed.id)!;
    const native = moverDistanceField(input.snapshot.map, objective.target.point, 'land')!;
    expect(unitArrival(landed, objective.target.entityId!)).toMatchObject({ status: 'reachable',
      ticks: Math.ceil(native.cost(actor)! / actor.speed * 20) });
  });

  it('refreshes E01 hostile routes from the same exact site field without changing observed intent', () => {
    const input = frame(), before = structuredClone(input.situation.lands.flatMap(land => land.threats));
    const situation = withAllocationMethodArrivals(input.snapshot, input.owner, input.memory, input.situation, input.methods, Infinity);
    const threats = situation.lands.flatMap(land => land.threats);
    for (const threat of threats.filter(threat => threat.siteId === input.objective.target.entityId)) for (const attacker of threat.attackers) {
      const unit = situation.units.find(unit => unit.id === attacker.unitId)!;
      expect(attacker.arrival).toBe(unitArrival(unit, threat.siteId));
      expect(attacker.intent).toEqual(before.find(previous => previous.siteId === threat.siteId)!.attackers.find(previous => previous.unitId === attacker.unitId)!.intent);
    }
  });
});
