import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createAiPolicyMemory } from '../memory';
import type { AllocationMethodQuoteInput } from './allocation-types';
import { buildStrategyDecision } from './decision';
import { conquestMethodProvider } from './conquest-methods';
import { landIdAt } from './regions';
import { forceSuccessProbability, quoteOpportunityCost } from './utility';

function sapphire(): AllocationMethodQuoteInput {
  const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['Ne-sapphireArchipelago-player-4-17991'];
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  const decision = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
  const objective = decision.objectives.find(goal => goal.kind === 'ConquerIsland' && goal.target.entityId === 'gold-satellite-2')!;
  const method = conquestMethodProvider.buildMethods({ snapshot: frame.snapshot, situation: decision.situation, objective,
    previous: null, executions: [], blocked: [] })[0]!;
  return { snapshot: frame.snapshot, situation: decision.situation, objective, method, budgets: [], executions: [],
    unitIds: [...[3661, 5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`), 'unit-player-4-worker-3'] };
}
describe('executable conquest methods from the real sapphire shortfall', () => {
  it('plans four borrowed soldiers, parallel assembly and native production, clearing, then one hall spend', () => {
    const input = sapphire(), method = conquestMethodProvider.materialize!(input);
    const training = method.actions.find(action => action.intent.kind === 'train-transport')!;
    const assembly = method.actions.find(action => action.executor === 'strategy.assemble')!;
    const deliver = method.actions.find(action => action.intent.kind === 'deliver-force')!;
    const clearing = method.actions.find(action => action.intent.kind === 'clear-camp')!;
    const wait = method.actions.find(action => action.intent.kind === 'wait-income')!;
    const build = method.actions.find(action => action.intent.kind === 'build-hall')!;
    const mining = method.actions.find(action => action.id === `${method.id}/start-mining`)!;
    expect(method.voyagePlans).toHaveLength(1);
    expect(method.voyagePlans![0]!.unitIds).toHaveLength(4);
    expect(training.dependsOn).toEqual([]);
    expect(training.unitIds).toEqual([]);
    expect(method.actions.every(action => action.unitIds !== undefined)).toBe(true);
    expect(assembly.dependsOn).toEqual([]);
    expect(assembly.unitIds).toEqual(method.voyagePlans![0]!.unitIds);
    expect(deliver.dependsOn).toEqual(expect.arrayContaining([training.id, assembly.id]));
    expect(clearing.dependsOn).toContain(deliver.id);
    expect(clearing.unitIds).toHaveLength(5);
    expect(wait.dependsOn).toContain(clearing.id);
    expect(build.dependsOn).toEqual(expect.arrayContaining([clearing.id, wait.id]));
    expect(wait.spendIds).toEqual(build.spendIds);
    expect(mining.unitIds).toEqual(['unit-player-4-worker-3']);
    expect(mining.dependsOn).toEqual(expect.arrayContaining([build.id, `${method.id}/garrison`]));
    expect(method.actions.find(action => action.id === `${method.id}/garrison`)!.completionEffects).toEqual([]);
    expect(mining.completionEffects).toEqual(input.objective.effects);
    expect(method.spends.filter(spend => !spend.includedUtilityTermCodes.includes('mining-worker-recruitment'))
      .map(spend => spend.amountGold).sort((a, b) => a - b)).toEqual([240, 400]);
    expect(method.actions.filter(action => action.executor === 'strategy.train-worker')).toHaveLength(4);
    expect(method.spends.filter(spend => spend.includedUtilityTermCodes.includes('mining-worker-recruitment'))
      .reduce((sum, spend) => sum + spend.amountGold, 0)).toBe(300);
    expect(input.situation.economy.cashGold).toBe(424);
    const quoted = conquestMethodProvider.quote({ ...input, method });
    // This event frame alone contains no published native voyage-risk batch.
    // A concrete plan is not permission to invent an empty-sea survival of 1.
    expect(quoted.status).toBe('blocked');
    expect(quoted.reason.code).toBe('voyage-stage-risk-unpublished');
    expect(quoted.utility).toBeNull();
    expect(quoted.force?.onStationUnitIds).toEqual([]);
    expect(quoted.force?.enRouteUnitIds).toHaveLength(5);
    expect(quoted.reason.values.assembledForce).toBeGreaterThan(quoted.force!.requiredForce);
    expect(quoted.reason.values.battleProbability).toBeCloseTo(forceSuccessProbability(
      Number(quoted.reason.values.assembledForce), Number(quoted.reason.values.actualOpponentForce)));
    expect(quoted.reason.values.netCapitalCash).toBe(-216);
    expect(method.actions.flatMap(action => action.unitIds ?? []).every(id => input.unitIds.includes(id))).toBe(true);
    expect(conquestMethodProvider.materialize!({ ...input, method })).toEqual(method);
  });

  it('keeps insufficient borrowed cohorts blocked instead of presenting the original four as implicitly available', () => {
    const input = sapphire(), reduced = { ...input, unitIds: ['unit-player-4-emberRavager-3661', 'unit-player-4-worker-3'] };
    const method = conquestMethodProvider.materialize!(reduced), quoted = conquestMethodProvider.quote({ ...reduced, method });
    expect(quoted.status).toBe('blocked');
    expect(quoted.reason.code).toBe('insufficient-assembled-clearing-force');
    expect(method.voyagePlans).toEqual([]);
    expect(method.spends.filter(spend => !spend.includedUtilityTermCodes.includes('mining-worker-recruitment')).map(spend => spend.amountGold)).toEqual([400]);
  });

  it('quotes a nearby safe full mine positively with real spare workers and reprices a competing commitment in the same window', () => {
    let scene = sketchScene('positive-conquest-plan').map('bareDuel').replaceDefaults().player('us', { team: 'a' })
      .player('foe', { team: 'b' }).playerState('us', { gold: 2000 }).goldMine('new', 1400, 1400, 10000)
      .townHall('us', 400, 400).townHall('foe', 4000, 4000);
    for (let n = 0; n < 5; n++) scene = scene.worker('us', 1500, 1400 + n * 10, { id: `spare-${n}` })
      .unit('us', 'emberRavager', 1450, 1400 + n * 10, { id: `guard-${n}` });
    const snapshot = snapshotGame(scene.build().createGame());
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const decision = buildStrategyDecision(snapshot, 'us', { memory: createAiPolicyMemory() }, undefined, undefined, Infinity);
    const target = { entityId: 'new', point: { x: 1400, y: 1400 }, landId: landIdAt(snapshot.map, { x: 1400, y: 1400 })! };
    const objective: AllocationMethodQuoteInput['objective'] = { id: 'new-site', kind: 'ConquerIsland', owner: 'us', target,
      effects: [{ kind: 'mining-established', mineId: 'new', completeHall: true, garrisonHandoff: true }],
      utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
      status: 'candidate', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [],
      stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } };
    const method = conquestMethodProvider.buildMethods({ snapshot, situation: decision.situation, objective, previous: null, executions: [], blocked: [] })[0]!;
    const input: AllocationMethodQuoteInput = { snapshot, situation: decision.situation, objective, method, budgets: [], executions: [],
      unitIds: snapshot.units.filter(unit => unit.owner === 'us').map(unit => unit.id) };
    const materialized = conquestMethodProvider.materialize!(input), quote = conquestMethodProvider.quote({ ...input, method: materialized });
    expect(quote.status).toBe('feasible');
    expect(quote.utility!.score).toBeGreaterThan(0);
    expect(quote.reason.values.trainingGold).toBe(0);
    expect(quote.utility!.cost.some(term => term.code === 'force-time' || term.code === 'new-transport')).toBe(false);
    const busy = conquestMethodProvider.quote({ ...input, method: materialized, valuation: { phase: 'net',
      opportunity: request => quoteOpportunityCost(request.window, [{ objectiveId: 'home-defense', unitIds: input.unitIds,
        withResourcesGold: 2000, withoutResourcesGold: null, withoutResourcesStatus: 'not-runnable', committed: false }]) } });
    expect(busy.status).toBe('feasible');
    expect(busy.utility!.score).toBeLessThan(0);
    expect(quote.utility!.score - busy.utility!.score).toBeCloseTo(2000);
  });

  it('does not silently replace a quoted production yard when another real shipyard is still available', () => {
    const input = sapphire();
    const situation = { ...input.situation, units: input.situation.units.map(unit => ({ ...unit,
      arrivals: unit.arrivals.map(row => {
        if (row.targetId !== input.objective.target.entityId) return row;
        const arrival = row.arrival;
        if (arrival.status === 'reachable') return { ...row, arrival: { ...arrival, crossings: arrival.crossings.map(crossing => ({ ...crossing,
          productionBuildingId: 'declared-shipyard-no-longer-present' })) } };
        if (arrival.status === 'conditional') return { ...row, arrival: { ...arrival, crossings: arrival.crossings.map(crossing => ({ ...crossing,
          productionBuildingId: 'declared-shipyard-no-longer-present' })) } };
        return row;
      }) })) };
    expect(input.snapshot.buildings.some(building => building.id === 'building-player-4-shipyard-1410' && building.complete)).toBe(true);
    const method = conquestMethodProvider.materialize!({ ...input, situation });
    expect(method.preconditions.some(condition => condition.reason.code === 'quoted-shipyard-unavailable')).toBe(true);
    expect(method.actions.some(action => action.executor === 'strategy.train-transport')).toBe(false);
    expect(method.voyagePlans).toEqual([]);
  });
});
