import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { distanceToHull, isShipKind } from '../../shared/ship-geometry';
import { snapshotGame } from '../../shared/sim';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createAiPolicyMemory } from '../memory';
import type { AllocationMethodQuoteInput, ExecutionAction } from './allocation-types';
import type { AssemblyFacts, AssemblyFactsRequest } from './assembly-facts';
import { conquestMethodProvider } from './conquest-methods';
import { bindConquestAssemblyPosts, conquestAssemblyPosts } from './conquest-rallies';
import { buildStrategyDecision } from './decision';
import { landIdAt } from './regions';
import type { OpportunityRequest, ValuationWindow } from './types';

function example(): AllocationMethodQuoteInput {
  let scene = sketchScene('assembly-provider-port').map('bareDuel').replaceDefaults()
    .player('us', { team: 'home' }).player('foe', { team: 'enemy' }).playerState('us', { gold: 2000 })
    .townHall('us', 400, 400).townHall('foe', 4000, 4000).building('us', 'barracks', 500, 650, { id: 'producer' })
    .goldMine('new', 2000, 2000, 10000).worker('us', 800, 850, { id: 'engineer' })
    .unit('neutral', 'ogreWarrior', 2000, 2000).unit('neutral', 'ogreMage', 2050, 2000);
  for (let i = 0; i < 12; i++) scene = scene.unit('us', 'emberRavager', 1000 + i * 20, 1000, { id: `fighter-${i}` });
  const snapshot = snapshotGame(scene.build().createGame());
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const decision = buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }, undefined, undefined, Infinity);
  const objective: AllocationMethodQuoteInput['objective'] = { id: 'conquest', kind: 'ConquerIsland', owner: 'us',
    target: { entityId: 'new', point: { x: 2000, y: 2000 }, landId: landIdAt(snapshot.map, { x: 2000, y: 2000 })! },
    effects: [{ kind: 'mining-established', mineId: 'new', completeHall: true, garrisonHandoff: true }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'candidate', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } };
  const method = conquestMethodProvider.buildMethods({ snapshot, situation: decision.situation, objective,
    previous: null, executions: [], blocked: [] })[0]!;
  const input = { snapshot, situation: decision.situation, objective, method, budgets: [], executions: [],
    unitIds: ['fighter-0', 'engineer'] };
  return { ...input, method: conquestMethodProvider.materialize!(input) };
}

const window: ValuationWindow = { taskTicks: 1000, holdingTicks: 1400, horizonTicks: 2400, discountTicks: 2400 };
/** Explicit quotation fixture. It does not stand in for calibrated supply,
 * native routing or a naturally selected grant. The continuation is already delayed. */
function facts(input: AllocationMethodQuoteInput): AssemblyFacts {
  const intent = input.method.actions[0]!.intent;
  if (intent.kind !== 'assemble-force') throw new Error('Expected coordinator');
  return { forecast: { status: 'gathering', forecastTick: input.snapshot.tick, readyTick: input.snapshot.tick + 1000,
    requiredForce: intent.requiredForce, assignedForce: 1, atRallyForce: 0, certainForce: 1, deficit: intent.requiredForce - 1,
    completionProbability: .5, conditionalForce: 9, conditionalProduction: null, conditionalSegments: [],
    fillScenarios: [{ id: 'fill', probability: .5, readyTick: input.snapshot.tick + 1000, conditionalForce: 9,
      production: [{ buildingId: 'producer', lane: 'training', fromTicks: 0, throughTicks: 1000 }] },
    { id: 'no-fill', probability: .5, readyTick: null, conditionalForce: 0, production: [] }],
    diagnostics: { scenarioCount: 2, scenarioLimitCount: 0 },
    certainReadyTick: null, supplies: [], forceCurve: [], missing: [],
    production: [{ buildingId: 'producer', lane: 'training', fromTicks: 0, throughTicks: 1000 }] },
  continuation: { assemblyDelayApplied: true, window,
    assumptions: [{ code: 'conditional-incumbent-production', factIds: ['producer'], values: { sampleCount: 10 } }],
    utility: { horizonTicks: 2400, successProbability: .8, persistenceBonus: 10, score: 710,
      benefit: [{ code: 'delayed-income', value: 1000 }],
      cost: [{ code: 'casualty', value: 100, catalogUnitValues: [{ unitId: 'fighter-0', valueGold: 100 }] }] } }, missing: [] };
}

function coordinatorExecution(input: AllocationMethodQuoteInput): ExecutionAction {
  const action = input.method.actions[0]!;
  return { token: { actionId: action.id, generation: 1 }, objectiveId: input.objective.id, methodId: input.method.id,
    executor: action.executor, intent: action.intent, target: action.target, dependsOn: [], completionEffects: [],
    status: 'complete', phase: 'ready-for-departure', sinceTick: 0, lastProgressTick: 0, state: {} };
}

describe('persistent conquest assembly quotation and handoff', () => {
  it('reserves only its real partial combat cohort and rebinds counterfactual subsets without hidden recruits', () => {
    const input = example(), before = JSON.stringify(input);
    expect(input.method.stage).toBe('assembly');
    expect(input.method.actions).toHaveLength(1);
    expect(input.method.actions[0]!.unitIds).toEqual(['fighter-0']);
    expect(input.method.spends).toEqual([]); expect(input.method.voyagePlans).toEqual([]);
    const reduced = conquestMethodProvider.materialize!({ ...input, unitIds: ['engineer'] });
    expect(reduced.actions[0]!.unitIds).toEqual([]);
    expect(reduced.actions[0]!.intent.kind === 'assemble-force' && reduced.actions[0]!.intent.posts.flatMap(post => post.unitIds)).toEqual([]);
    expect(reduced.id).toBe(input.method.id);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('integrates fill probability once, preserves monetary terms, and charges one same-window group opportunity', () => {
    const input = example(), supplied = facts(input), before = JSON.stringify({ input, supplied });
    const calls: AssemblyFactsRequest[] = [], opportunities: OpportunityRequest[] = [];
    const reader = (request: AssemblyFactsRequest) => { calls.push(request); return supplied; };
    const gross = conquestMethodProvider.quote({ ...input, assemblyFacts: reader });
    expect(gross.status).toBe('feasible'); expect(gross.utility?.score).toBe(355);
    expect(gross.utility?.benefit).toEqual([{ code: 'delayed-income', value: 400 }]);
    expect(gross.utility?.cost).toEqual([{ code: 'casualty', value: 50, catalogUnitValues: [{ unitId: 'fighter-0', valueGold: 50 }] }]);
    const valuation: NonNullable<AllocationMethodQuoteInput['valuation']> = { phase: 'net', window,
      unavailableUnitIds: ['borrowed'], allowedProduction: [{ buildingId: 'producer', lane: 'training' }],
      unavailableProduction: [{ buildingId: 'producer', lane: 'research', fromTicks: 0, throughTicks: 1000 }],
      opportunity: request => { opportunities.push(request); return { status: 'known', window: request.window, gold: 60,
        basis: 'feasible-bundle-quotes', alternatives: [] }; } };
    const net = conquestMethodProvider.quote({ ...input, assemblyFacts: reader, valuation });
    expect(net.utility?.score).toBe(295); expect(net.utility?.successProbability).toBe(1);
    expect(net.utility?.persistenceBonus).toBe(5);
    expect(net.assumptions).toEqual(supplied.continuation!.assumptions);
    expect(net.utility?.cost.filter(term => term.code === 'assembly-bundle-opportunity')).toEqual([{ code: 'assembly-bundle-opportunity', value: 60 }]);
    expect(opportunities).toEqual([{ objectiveId: input.objective.id, methodId: input.method.id, unitIds: ['fighter-0'],
      production: supplied.forecast.production, window }]);
    expect(calls).toHaveLength(2); expect(calls[1]?.valuation).toBe(valuation);
    expect(calls.every(request => request.unitIds.length === 1 && request.unitIds[0] === 'fighter-0')).toBe(true);
    expect(JSON.stringify({ input, supplied })).toBe(before);
  });

  it('quotes a proven positive supply lower bound with dedicated selection metadata and retains its unresolved tail', () => {
    const input = example(), supplied = facts(input), model = { ...supplied, forecast: { ...supplied.forecast,
      probabilityBasis: 'proven-lower-bound' as const, completionProbabilityBounds: { lower: .5, upper: 1 },
      diagnostics: { scenarioCount: 2, scenarioLimitCount: 0, unresolvedProbability: .5 },
      missing: [{ code: 'assembly-conditional-support-exhausted', status: 'unknown' as const, factIds: ['no-fill'] }] } };
    const quote = conquestMethodProvider.quote({ ...input, assemblyFacts: () => model });
    expect(quote.status).toBe('feasible'); expect(quote.utility?.score).toBe(355);
    expect(quote.valuationBasis).toEqual({ kind: 'proven-lower-bound', probabilityLower: .5, probabilityUpper: 1, unresolvedProbability: .5 });
    expect(quote.reason.values.probabilityUpper).toBe(1);
    expect(quote.reason.values.unresolvedProbability).toBe(.5);
    expect(conquestMethodProvider.quote({ ...input, assemblyFacts: () => supplied }).valuationBasis).toBeUndefined();
    const mismatched = conquestMethodProvider.quote({ ...input, assemblyFacts: () => ({ ...model,
      forecast: { ...model.forecast, completionProbabilityBounds: { lower: .6, upper: 1 } } }) });
    expect(mismatched.status).toBe('blocked');
    expect(mismatched.missingPreconditions.some(condition => condition.reason.code === 'assembly-probability-bound-unquoted')).toBe(true);
  });

  it('keeps finite zero supply a known needs-production deficit without requiring a nonexistent continuation', () => {
    const input = example(), supplied = facts(input);
    const quoted = conquestMethodProvider.quote({ ...input, assemblyFacts: () => ({ ...supplied, continuation: null,
      forecast: { ...supplied.forecast, status: 'blocked', readyTick: null, completionProbability: 0,
        missing: [{ code: 'needs-production', status: 'unmet', factIds: ['producer'] }] } }),
    valuation: { phase: 'net', opportunity: () => { throw new Error('Blocked supply must not request opportunity'); } } });
    expect(quoted.status).toBe('blocked'); expect(quoted.utility).toBeNull();
    expect(quoted.missingPreconditions.map(condition => [condition.reason.code, condition.status]))
      .toEqual([['needs-production', 'unmet']]);
    expect(quoted.missingPreconditions[0]!.reason.values).toEqual({ requiredForce: supplied.forecast.requiredForce,
      certainForce: 1, deficit: supplied.forecast.deficit });
  });

  it('retains missing facts and rejects stale forecasts, mismatched windows and unpriced displacement', () => {
    const input = example(), supplied = facts(input);
    expect(conquestMethodProvider.quote(input).missingPreconditions.some(condition => condition.reason.code === 'assembly-facts-unquoted')).toBe(true);
    const stale = conquestMethodProvider.quote({ ...input, assemblyFacts: () => ({ ...supplied,
      forecast: { ...supplied.forecast, forecastTick: input.snapshot.tick - 1 } }) });
    expect(stale.missingPreconditions.some(condition => condition.reason.code === 'assembly-current-completion-forecast-unquoted')).toBe(true);
    const mismatch = conquestMethodProvider.quote({ ...input, assemblyFacts: () => supplied,
      valuation: { phase: 'gross', window: { ...window, horizonTicks: 2401 } } });
    expect(mismatch.missingPreconditions.some(condition => condition.reason.code === 'assembly-continuation-window-mismatch')).toBe(true);
    const unknown = conquestMethodProvider.quote({ ...input, assemblyFacts: () => supplied, valuation: { phase: 'net' } });
    expect(unknown.status).toBe('blocked');
    expect(unknown.missingPreconditions.some(condition => condition.reason.code === 'committed-opportunity-cost-unknown')).toBe(true);
  });

  it('hands the same persistent method to full execution only after the real post cohort is sufficient', () => {
    const input = example(), prior = coordinatorExecution(input);
    const more = { ...input, executions: [prior], unitIds: [...Array.from({ length: 12 }, (_, i) => `fighter-${i}`), 'engineer'] };
    const approaching = conquestMethodProvider.materialize!(more);
    expect(approaching.stage).toBe('assembly');
    const action = approaching.actions[0]!;
    if (action.intent.kind !== 'assemble-force') throw new Error('Expected coordinator');
    // A pure HTN handoff boundary, not an executed navigation claim.
    for (const post of action.intent.posts) for (const id of post.unitIds) {
      const unit = input.snapshot.units.find(unit => unit.id === id)!;
      unit.x = post.target.point.x; unit.y = post.target.point.y;
    }
    const full = conquestMethodProvider.materialize!({ ...more, method: approaching });
    expect(full.id).toBe(input.method.id); expect(full.stage).toBe('execution');
    expect(full.actions.some(action => action.intent.kind === 'assemble-force')).toBe(false);
    expect(full.actions.some(action => action.intent.kind === 'clear-camp')).toBe(true);
    expect(full.actions.find(action => action.intent.kind === 'build-hall')?.unitIds).toEqual(['engineer']);
    expect(full.spends.some(spend => spend.amountGold === 400)).toBe(true);
    expect(full.actions.flatMap(action => action.unitIds ?? []).every(id => more.unitIds.includes(id))).toBe(true);
    const interruptedUnitIds = more.unitIds.filter(id => id !== 'fighter-0');
    const interrupted = conquestMethodProvider.materialize!({ ...more, method: approaching, interruptedUnitIds });
    expect(interrupted.stage).toBe('assembly');
    let observed: AssemblyFactsRequest | undefined;
    const quoted = conquestMethodProvider.quote({ ...more, method: interrupted, interruptedUnitIds,
      assemblyFacts: request => { observed = request; return facts({ ...more, method: interrupted }); } });
    expect(observed?.interruptedUnitIds).toBe(interruptedUnitIds);
    expect(quoted.force?.onStationUnitIds).toEqual(['fighter-0']);
    expect(quoted.force?.unavailableUnitIds).toEqual(interruptedUnitIds.filter(id => id !== 'engineer').sort());
  });

  it('retains a bounded scenario-limit leaf and its count without quoting an unavailable continuation', () => {
    const input = example(), supplied = facts(input);
    const quoted = conquestMethodProvider.quote({ ...input, assemblyFacts: () => ({ ...supplied, continuation: null,
      forecast: { ...supplied.forecast, status: 'unknown', readyTick: null, completionProbability: 0,
        diagnostics: { scenarioCount: 65, scenarioLimitCount: 1 },
        missing: [{ code: 'assembly-scenario-limit', status: 'unknown', factIds: [] }] } }) });
    expect(quoted.status).toBe('blocked');
    expect(quoted.missingPreconditions.map(condition => condition.reason.code)).toEqual(['assembly-scenario-limit']);
    expect(quoted.reason.values.scenarioCount).toBe(65);
    expect(quoted.reason.values.scenarioLimitCount).toBe(1);
  });
});

describe('land-local conquest rally facts', () => {
  it('binds real Ne members to separate safe observed island posts and retains the exact posts across subsets', () => {
    const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
      new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString())
      .frames['Ne-sapphireArchipelago-player-4-17991'];
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    const decision = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
    const objective = decision.objectives.find(goal => goal.kind === 'ConquerIsland' && goal.target.entityId === 'gold-satellite-2')!;
    const method = conquestMethodProvider.buildMethods({ snapshot: frame.snapshot, situation: decision.situation,
      objective, previous: null, executions: [], blocked: [] })[0]!;
    const unitIds = [3661, 5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`);
    const input = { snapshot: frame.snapshot, situation: decision.situation, objective, executions: [], methodId: method.id, unitIds };
    const before = JSON.stringify(input), bound = bindConquestAssemblyPosts(input);
    expect(bound.missing).toEqual([]);
    expect(new Set(bound.posts.filter(post => post.unitIds.length).map(post => post.target.landId)).size).toBeGreaterThan(1);
    expect(bound.posts.flatMap(post => post.unitIds).sort()).toEqual([...unitIds].sort());
    const hulls = frame.snapshot.units.filter(unit => unit.hp > 0 && isShipKind(unit.kind));
    for (const post of bound.posts) for (const id of post.unitIds) {
      const unit = frame.snapshot.units.find(unit => unit.id === id)!;
      expect(landIdAt(frame.snapshot.map, unit)).toBe(post.target.landId);
      expect(landIdAt(frame.snapshot.map, post.target.point)).toBe(post.target.landId);
      expect(hulls.every(hull => distanceToHull(hull, post.target.point) > unit.radius)).toBe(true);
    }
    const execution: ExecutionAction = { token: { actionId: `${method.id}/assemble-force`, generation: 1 },
      objectiveId: objective.id, methodId: method.id, executor: 'strategy.assemble-force',
      intent: { kind: 'assemble-force', campTarget: objective.target, requiredForce: 10, posts: bound.posts },
      target: bound.posts[0]!.target, dependsOn: [], completionEffects: [], status: 'active', phase: 'assembling-force',
      sinceTick: frame.snapshot.tick, lastProgressTick: frame.snapshot.tick, state: {} };
    const subset = bindConquestAssemblyPosts({ ...input, executions: [execution], unitIds: unitIds.slice(0, 1) });
    expect(subset.posts.map(post => ({ id: post.id, target: post.target })))
      .toEqual(bound.posts.map(post => ({ id: post.id, target: post.target })));
    expect(subset.posts.flatMap(post => post.unitIds)).toEqual(unitIds.slice(0, 1));
    expect(JSON.stringify(input)).toBe(before);
  });

  it('uses actual team relations and refuses an invented land post for an aboard member', () => {
    const input = example(), own = input.snapshot.units.find(unit => unit.id === 'fighter-0')!;
    const ally = structuredClone(own); ally.id = 'ally'; ally.owner = 'ally'; ally.attackRange = 5000;
    input.snapshot.units.push(ally); input.snapshot.teams = { ...input.snapshot.teams, ally: 'home', us: 'home', foe: 'enemy' };
    const base = { ...input, methodId: input.method.id };
    const posts = conquestAssemblyPosts(base);
    expect(posts.length).toBeGreaterThan(0);
    expect(conquestAssemblyPosts({ ...base, snapshot: { ...input.snapshot,
      units: input.snapshot.units.filter(unit => unit.id !== ally.id) } })).toEqual(posts);
    own.deck = { shipId: 'actual-hull', x: 0, y: 0 };
    const aboard = bindConquestAssemblyPosts({ ...base, unitIds: [own.id] });
    expect(aboard.posts.flatMap(post => post.unitIds)).toEqual([]);
    expect(aboard.missing).toMatchObject([{ status: 'unknown', reason: { code: 'assembly-aboard-origin-unquoted', factIds: [own.id] } }]);
  });
});
