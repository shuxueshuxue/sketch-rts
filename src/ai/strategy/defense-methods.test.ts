import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { strengthOf } from '../policy/v6/strength';
import type { AllocationMethodQuoteInput, ExecutorInput } from './allocation-types';
import { defenseMethodProvider } from './defense-methods';
import { evacuateExecutor } from './executors/evacuate';
import { buildStrategyDecision } from './decision';
import type { DecisionFacts } from './decision';
import { landIdAt } from './regions';
import type { Objective, Situation } from './types';
import { forceSuccessProbability, quoteOpportunityCost } from './utility';
import { assertUnitValueSides } from './unit-value-ledger';
import { createUnit } from '../../shared/map';

function defendedPost(): AllocationMethodQuoteInput {
  const scene = sketchScene('defense-value-counterfactual').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .building('us', 'townHall', 1400, 1400, { id: 'hall' })
    .building('us', 'defenseTower', 1500, 1400)
    .unit('foe', 'footman', 1700, 1400);
  for (let i = 0; i < 6; i++) scene.unit('us', 'emberRavager', 1600, 1400 + i * 3);
  const snapshot = snapshotGame(scene.build().createGame());
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const hall = snapshot.buildings.find(building => building.id === 'hall')!;
  const target = { entityId: hall.id, landId: landIdAt(snapshot.map, hall)!, point: { x: hall.x, y: hall.y } };
  const enemy = snapshot.units.find(unit => unit.owner === 'foe')!, party = snapshot.units.filter(unit => unit.owner === 'us');
  const arrival = { status: 'reachable' as const, ticks: 0, landTicks: 0, crossings: [] as const, evidence: [] };
  const situation: Situation = { tick: snapshot.tick, owner: 'us', horizonTicks: 2400, seas: [], opportunities: [], limitations: [],
    economy: { cashGold: 1000, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] },
    units: party.map(unit => ({ id: unit.id, owner: unit.owner, kind: unit.kind, hp: unit.hp, maxHp: unit.maxHp,
      location: { kind: 'land', landId: target.landId, point: unit }, strength: strengthOf([unit]),
      roles: ['frontline'], expiresTick: null, commitments: [], arrivals: [] })),
    assets: [{ id: hall.id, owner: 'us', kind: 'hall', target, hp: hall.hp, complete: true,
      replacementGold: 400, remainingGold: 0, incomeGoldPerTick: 0, discountedValueGold: 400 }],
    lands: [{ id: target.landId, anchor: target.point, assetIds: [hall.id], unitIds: party.map(unit => unit.id), adjacentSeaIds: [],
      threats: [{ siteId: hall.id, horizonTicks: 900, attackers: [{ unitId: enemy.id, arrival, strength: 1,
        intent: { kind: 'actual-intrusion', actualSiteId: hall.id, redirectGroupId: 'native-enemy', basis: 'native-target' } }],
        arrivedStrength: 1, incomingStrength: 0, friendlyOnStationStrength: strengthOf(party), firstArrivalTicks: 0,
        lossProbability: .01, evidence: [] }] }] };
  const objective: Objective = { id: 'defend-hall', kind: 'DefendSite', owner: 'us', target,
    effects: [{ kind: 'force-present', landId: target.landId, minimumStrength: 1, throughTick: snapshot.tick + 900 }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0, evidence: [] },
    status: 'active', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } };
  const method = defenseMethodProvider.buildMethods({ snapshot, situation, objective, previous: null, executions: [], blocked: [] })
    .find(method => method.kind === 'local-squad')!;
  return { snapshot, situation, objective, method, unitIds: party.map(unit => unit.id), executions: [], budgets: [] };
}

function namedNeEvacuation(): AllocationMethodQuoteInput {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString())
    .frames['Ne-sapphireArchipelago-player-4-17991'];
  const snapshot = frame.snapshot as AllocationMethodQuoteInput['snapshot'];
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const decision = buildStrategyDecision(snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
  const workerId = 'unit-player-4-worker-1980';
  const worker = snapshot.units.find(unit => unit.id === workerId)!, subject = snapshot.units.find(unit => unit.id === 'unit-player-4-worker-3')!;
  expect(worker.kind).toBe('worker');
  const refuge = decision.situation.assets.find(asset => asset.owner === frame.owner && asset.kind === 'hall' && asset.complete
    && asset.target.landId === landIdAt(snapshot.map, worker))!;
  // The runtime collector's Evacuate proposal is newer than the frozen
  // read-only goal generator here. Its named subject and refuge use this
  // unchanged real world; no unit is spawned or moved for the regression.
  const objective: AllocationMethodQuoteInput['objective'] = { id: 'Evacuate:player-4:unit-player-4-worker-3',
    owner: frame.owner, kind: 'Evacuate', target: { entityId: subject.id, landId: landIdAt(snapshot.map, subject)!,
      point: { x: subject.x, y: subject.y } }, effects: [{ kind: 'assets-evacuated', unitIds: [subject.id], destination: refuge.target }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'candidate', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } };
  const skeleton = defenseMethodProvider.buildMethods({ snapshot, situation: decision.situation, objective,
    previous: null, executions: [], blocked: [] })[0]!;
  const method = { ...skeleton, actions: skeleton.actions.filter(action => action.executor !== 'strategy.transport')
    .map(action => ({ ...action, unitIds: [workerId] })) };
  return { snapshot, situation: decision.situation, objective, method,
    unitIds: [workerId], budgets: [], executions: [] };
}

function evacuationGrant(input: AllocationMethodQuoteInput): ExecutorInput {
  const action = input.method.actions.at(-1)!, token = { actionId: action.id, generation: 1 };
  return { snapshot: input.snapshot, owner: input.situation.owner, objective: input.objective, method: input.method,
    execution: { token, objectiveId: input.objective.id, methodId: input.method.id, executor: action.executor, intent: action.intent,
      target: action.target, dependsOn: action.dependsOn, completionEffects: action.completionEffects,
      status: 'active', phase: 'evacuating', sinceTick: input.snapshot.tick, lastProgressTick: input.snapshot.tick, state: {} },
    grant: { revision: 1, action: token, objectiveId: input.objective.id, methodId: input.method.id,
      leases: input.unitIds.map(id => ({ id: `lease:${id}`, resourceKey: `unit:${id}`, objectiveId: input.objective.id,
        methodId: input.method.id, action: token, sinceTick: input.snapshot.tick, minimumStayUntilTick: input.snapshot.tick,
        origin: 'allocator', incumbentTask: null })),
      assignments: [], budgets: [], voyages: [], orders: [], commands: [], orderOverrides: [] }, events: [] };
}

describe('defense protection and whole-bundle valuation', () => {
  it('does not revive the removed Ne worker from a previously concrete local evacuation', () => {
    const input = { ...namedNeEvacuation(), unitIds: [] };
    const before = JSON.stringify(input), removed = defenseMethodProvider.materialize!(input);
    expect(removed.actions.flatMap(action => action.unitIds ?? [])).toEqual([]);
    expect(defenseMethodProvider.materialize!({ ...input, method: removed })).toEqual(removed);
    const cold: AllocationMethodQuoteInput = JSON.parse(before);
    setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(defenseMethodProvider.materialize!(cold)).toEqual(removed);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('cannot substitute another real Ne worker for the named evacuation subject', () => {
    const input = namedNeEvacuation(), before = JSON.stringify(input);
    const materialized = defenseMethodProvider.materialize!(input);
    expect(materialized.actions.flatMap(action => action.unitIds ?? [])).toEqual([]);
    expect(materialized.actions.at(-1)!.completionEffects).toEqual(input.objective.effects);
    const quote = defenseMethodProvider.quote({ ...input, method: materialized });
    expect(quote.status).toBe('blocked');
    expect(quote.reason.code).toBe('evacuation-subject-not-granted');
    expect(quote.missingPreconditions[0]!.kind).toBe('workers');
    const result = evacuateExecutor.execute(evacuationGrant(input));
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]!.reason).toBe('evacuation-subject-not-granted');
    expect(result.commands).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps a generic DefendSite evacuation fallback scoped to its granted workers', () => {
    const named = namedNeEvacuation(), objective = { ...named.objective, kind: 'DefendSite' as const, effects: [] };
    const input = { ...named, objective };
    const materialized = defenseMethodProvider.materialize!(input);
    expect(materialized.actions.at(-1)!.unitIds).toEqual(input.unitIds);
    const result = evacuateExecutor.execute(evacuationGrant(input));
    expect(result.reasons.some(reason => reason.reason === 'evacuation-subject-not-granted')).toBe(false);
    expect(result.commands.flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : [])
      .every(id => input.unitIds.includes(id))).toBe(true);
  });

  it('keeps the named Ne subject when it is actually granted without adding the other worker', () => {
    const input = { ...namedNeEvacuation(), unitIds: ['unit-player-4-worker-3'] };
    const materialized = defenseMethodProvider.materialize!(input);
    expect(materialized.actions.at(-1)!.unitIds).toEqual(input.unitIds);
    const result = evacuateExecutor.execute(evacuationGrant({ ...input, method: materialized }));
    expect(result.reasons.some(reason => reason.reason === 'evacuation-subject-not-granted')).toBe(false);
    expect(result.commands.flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : [])
      .every(id => input.unitIds.includes(id))).toBe(true);
  });

  it('rebinds a previously concrete local defense to the current counterfactual subset', () => {
    const input = defendedPost(), unitIds = input.unitIds.slice(1);
    const method = { ...input.method, actions: input.method.actions.map(action => ({ ...action, unitIds: input.unitIds })) };
    const reduced = defenseMethodProvider.materialize!({ ...input, method, unitIds });
    expect(reduced.actions.flatMap(action => action.unitIds ?? [])).toEqual(unitIds);
  });

  it('rematerializes the real E01 local shipyard cohort after its unnecessary deliver action was removed', () => {
    const frame = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString())
      .frames['gullIsland-p0-9930'];
    const snapshot = frame.snapshot as AllocationMethodQuoteInput['snapshot'];
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const decision = buildStrategyDecision(snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
    const objective = decision.objectives.find(goal => goal.id === 'DefendSite:p0:building-p0-shipyard-1409')!;
    expect(objective).toBeDefined();
    const method = defenseMethodProvider.buildMethods({ snapshot, situation: decision.situation, objective,
      previous: null, executions: [], blocked: [] }).find(method => method.kind === 'cross-sea-reinforcement')!;
    const unitIds = decision.situation.units.filter(unit => unit.owner === frame.owner && unit.location.kind === 'land'
      && unit.location.landId === objective.target.landId && !unit.roles.some(role => ['worker', 'transport', 'warship'].includes(role)))
      .map(unit => unit.id);
    expect(unitIds.length).toBeGreaterThan(0);
    const input: AllocationMethodQuoteInput = { snapshot, situation: decision.situation, objective, method, unitIds, budgets: [], executions: [] };
    const first = defenseMethodProvider.materialize!(input);
    expect(first.actions.some(action => action.executor === 'strategy.transport')).toBe(false);
    const before = JSON.stringify({ ...input, method: first });
    const second = defenseMethodProvider.materialize!({ ...input, method: first });
    expect(second).toEqual(first);
    expect(defenseMethodProvider.materialize!({ ...input, method: second })).toEqual(first);
    const cold: AllocationMethodQuoteInput = JSON.parse(before);
    setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(defenseMethodProvider.materialize!(cold)).toEqual(first);
    expect(JSON.stringify({ ...input, method: first })).toBe(before);
  });

  it('keeps the real E02 island-worker evacuation behind explicit transport instead of a cross-water walk', () => {
    const frame = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString())
      .frames['gullIsland-p0-17505'];
    const snapshot = frame.snapshot as AllocationMethodQuoteInput['snapshot'];
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const decision = buildStrategyDecision(snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
    const source = decision.situation.assets.find(asset => asset.id === 'building-p0-townHall-9337')!;
    const refuge = decision.situation.assets.find(asset => asset.owner === frame.owner && asset.kind === 'hall'
      && asset.complete && asset.target.landId !== source.target.landId)!;
    expect(refuge).toBeDefined();
    const objective: AllocationMethodQuoteInput['objective'] = { id: 'E02-evacuate', owner: frame.owner, kind: 'Evacuate', target: source.target,
      effects: [{ kind: 'assets-evacuated', unitIds: ['unit-p0-worker-1'], destination: refuge.target }],
      utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
      status: 'candidate', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [],
      stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } };
    const method = defenseMethodProvider.buildMethods({ snapshot, situation: decision.situation, objective, previous: null, executions: [], blocked: [] })[0]!;
    const input: AllocationMethodQuoteInput = { snapshot, situation: decision.situation, objective, method,
      unitIds: ['unit-p0-worker-1'], budgets: [], executions: [] };
    const materialized = defenseMethodProvider.materialize!(input), transport = materialized.actions.find(action => action.executor === 'strategy.transport')!;
    expect(transport.intent.kind).toBe('deliver-workers');
    expect(materialized.actions.at(-1)!.dependsOn).toContain(transport.id);
    expect(materialized.actions.at(-1)!.target).toEqual(refuge.target);
    expect(materialized.actions.flatMap(action => action.unitIds ?? []).every(id => input.unitIds.includes(id))).toBe(true);
    // The old ferry/hull is not ours merely because it is physically nearby.
    expect(materialized.preconditions.length + (materialized.voyagePlans?.length ?? 0)).toBeGreaterThan(0);
    expect(defenseMethodProvider.quote({ ...input, method: materialized }).status).toBe('blocked');
  });

  it('does not charge a second site the full enemy army or invent intent for older captures', () => {
    const input = defendedPost();
    const potential = { ...input.situation, lands: input.situation.lands.map(land => ({ ...land, threats: land.threats.map(threat => ({ ...threat,
      attackers: threat.attackers.map(attacker => ({ ...attacker, arrival: { ...attacker.arrival, ticks: 100 }, intent: { kind: 'potential-redirect' as const,
        actualSiteId: 'other-front-mine', redirectGroupId: 'native-enemy', basis: 'native-target' as const } })) })) })) };
    const redirect = defenseMethodProvider.quote({ ...input, situation: potential });
    expect(redirect.status).toBe('feasible');
    expect(redirect.reason.values.actualIntrusionCount).toBe(0);
    expect(redirect.reason.values.potentialRedirectCount).toBe(1);
    // The remaining real tower is enough to respond even with this entire
    // quoted cohort removed. Its protection cannot be sold a second time.
    expect(redirect.reason.values.otherResponseTicks).toBe(0);
    expect(redirect.utility!.score).toBe(0);
    const oldCapture = { ...input.situation, lands: input.situation.lands.map(land => ({ ...land, threats: land.threats.map(threat => ({ ...threat,
      attackers: threat.attackers.map(({ intent: _intent, ...attacker }) => attacker) })) })) };
    const unknown = defenseMethodProvider.quote({ ...input, situation: oldCapture });
    expect(unknown.status).toBe('blocked');
    expect(unknown.reason.code).toBe('defense-response-or-intent-unknown');
    expect(unknown.utility).toBeNull();
  });

  it('prices actual opposition once and subtracts the static-only counterfactual exactly', () => {
    const input = defendedPost(), before = JSON.stringify(input), quote = defenseMethodProvider.quote(input);
    expect(quote.status).toBe('feasible');
    const utility = quote.utility!;
    expect(() => assertUnitValueSides(utility)).not.toThrow();
    expect(quote.reason.values.actualOpposition).toBe(1);
    expect(utility.successProbability).toBe(forceSuccessProbability(quote.force!.effectiveForce + 1.3, 1));
    expect(quote.force!.requiredForce).toBe(0);
    expect(utility.cost.find(term => term.code === 'static-protection-baseline')!.value)
      .toBeCloseTo(utility.benefit[0]!.value * forceSuccessProbability(1.3, 1));
    expect(utility.cost.some(term => term.code === 'force-time')).toBe(false);
    const zero = defenseMethodProvider.quote({ ...input, unitIds: [] });
    expect(zero.status).toBe('feasible');
    expect(zero.utility!.score).toBeCloseTo(0);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('identifies a protected worker benefit without also charging that worker as a combat loss', () => {
    const input = defendedPost(), worker = createUnit('protected-worker', 'us', 'worker', 1350, 1400);
    const quote = defenseMethodProvider.quote({ ...input, snapshot: { ...input.snapshot, units: [...input.snapshot.units, worker] },
      situation: { ...input.situation, assets: [...input.situation.assets, { id: worker.id, owner: worker.owner, kind: 'worker',
        target: { entityId: worker.id, landId: input.objective.target.landId!, point: worker }, hp: worker.hp, complete: true,
        replacementGold: 75, remainingGold: 0, incomeGoldPerTick: 0, discountedValueGold: 75 }] } });
    expect(quote.status).toBe('feasible');
    expect(quote.utility!.benefit.flatMap(term => term.catalogUnitValues ?? []).map(entry => entry.unitId)).toContain(worker.id);
    expect(quote.utility!.cost.flatMap(term => term.catalogUnitValues ?? []).some(entry => entry.unitId === worker.id)).toBe(false);
    expect(() => assertUnitValueSides(quote.utility!)).not.toThrow();
  });

  it('uses the allocator response pool without erasing an idle reservation commitment', () => {
    const original = defendedPost(), reserve = original.unitIds.slice(-2);
    const arrival = { status: 'reachable' as const, ticks: 0, landTicks: 0, crossings: [], evidence: [] };
    const input = { ...original,
      snapshot: { ...original.snapshot, buildings: original.snapshot.buildings.filter(building => building.kind !== 'defenseTower') },
      unitIds: original.unitIds.slice(0, -2), situation: { ...original.situation, units: original.situation.units.map(unit => reserve.includes(unit.id)
        ? { ...unit, arrivals: [{ targetId: original.method.actions.at(-1)!.id, arrival }],
          commitments: [{ source: 'unitClaims.expansion', taskId: 'idle-reservation', objectiveId: null, role: unit.roles[0]! }] } : unit) } };
    const before = JSON.stringify(input);
    expect(defenseMethodProvider.quote(input).reason.values.otherResponseTicks).toBeNull();
    expect(defenseMethodProvider.quote({ ...input, responseEligibleUnitIds: reserve }).reason.values.otherResponseTicks).toBe(0);
    expect(defenseMethodProvider.quote({ ...input, responseEligibleUnitIds: [] }).reason.values.otherResponseTicks).toBeNull();
    expect(JSON.stringify(input)).toBe(before);
  });

  it('does not reuse an incumbent risk discount and charges only the collector actual alternative', () => {
    const input = defendedPost(), original = defenseMethodProvider.quote(input);
    const changed: DecisionFacts<Situation> = { ...input.situation, lands: input.situation.lands.map(land => ({ ...land,
      threats: land.threats.map(threat => ({ ...threat, lossProbability: .99, friendlyOnStationStrength: 1000 })) })) };
    expect(defenseMethodProvider.quote({ ...input, situation: changed }).utility).toEqual(original.utility);
    const free = defenseMethodProvider.quote({ ...input, valuation: { phase: 'net',
      opportunity: request => quoteOpportunityCost(request.window, []) } });
    const busy = defenseMethodProvider.quote({ ...input, valuation: { phase: 'net',
      opportunity: request => quoteOpportunityCost(request.window, [{ objectiveId: 'other-post', unitIds: input.unitIds,
        withResourcesGold: 1000, withoutResourcesGold: null, withoutResourcesStatus: 'not-runnable', committed: false }]) } });
    expect(free.status).toBe('feasible');
    expect(busy.status).toBe('feasible');
    expect(free.utility!.score - busy.utility!.score).toBeCloseTo(1000);
    expect(busy.utility!.score).toBeLessThan(0);
  });
});
