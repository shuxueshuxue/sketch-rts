import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { BUILDING_DEFS, UNIT_DEFS, requiredSupplyCap } from '../../shared/catalog';
import { snapshotGame, stepGame, tryPlayerCommand } from '../../shared/sim';
import { createBuilding } from '../../shared/map';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot } from '../../shared/types';
import { goalFact } from './goal-facts';
import { declareGoalBuilding, declareGoalTraining, declareGoalWaitIncome } from './goal-economy-actions';
import type { GoalFact, GoalFactObservation, GoalPlanningContext } from './goal-planner-types';
import type { Situation, Target } from './types';
import { combatRating } from '../policy/v6/strength';
import { projectGoalResources } from './goal-resource-ledger';
import { FactWorkQueue } from './fact-work';
import { planGoals } from './goal-planner';
import { retimeGoalActionPreconditions } from './goal-action-facts';

function nativeScene() {
  const game = sketchScene('economic-action-native-rules').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 3000 })
    .townHall('us', 350, 350, { id: 'hall' }).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 650, 350, { id: 'barracks' })
    .building('us', 'stables', 650, 650, { id: 'stables' })
    .worker('us', 950, 800, { id: 'worker' })
    .farms('us', 8, 250, 1100).build().createGame();
  game.scriptedVictory = true;
  return game;
}
const at: Target = { landId: 'land:1', point: { x: 650, y: 350 } };
const site: Target = { landId: 'land:1', point: { x: 950, y: 950 } };
const worker = { ref: { kind: 'existing', entityId: 'worker' } as const,
  from: { landId: 'land:1' as const, point: { x: 950, y: 800 } } };
function context(snapshot: GameSnapshot, readFact: GoalPlanningContext['readFact'] = () => { throw Error('Unexpected fact query'); }): GoalPlanningContext {
  // The declaration unit tests do not replace the shared fact source or test
  // regression. Route/income tests below explicitly exercise its typed port.
  const situation: Situation = { tick: snapshot.tick, owner: 'us', horizonTicks: 2400, lands: [], seas: [], assets: [], units: [],
    opportunities: [], economy: { cashGold: snapshot.players.us!.gold, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] }, limitations: [] };
  return { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_summoner', readFact };
}
function road(fact: GoalFact, ticks = 15): GoalFactObservation {
  return { fact, state: 'met', observedTick: 0, revision: 'road-1', reason: { code: 'shared-route', factIds: [fact.id], values: {} },
    evidence: [], route: { distance: 150, ticks, points: [worker.from.point, site.point] } };
}

describe('grounded economic declarations against native rules', () => {
  it('keeps retained building capital in the cash prefix rather than making a profitable asset goal negative', () => {
    const snapshot = snapshotGame(nativeScene()), planning = context(snapshot, fact => fact.predicate.kind === 'route' ? road(fact) : {
      fact, state: fact.predicate.kind === 'building-complete' ? 'unmet' : 'met', observedTick: snapshot.tick,
      revision: 'native-capital-contract', reason: { code: 'native-capital-contract', factIds: [fact.id], values: {} }, evidence: [],
      ...(fact.predicate.kind === 'gold' ? { quantity: snapshot.players.us!.gold } : {}),
    });
    const action = declareGoalBuilding({ buildingKind: 'farm', at: site, worker, byTick: 5000 }, planning)!;
    const effect = goalFact({ kind: 'building-complete', buildingKind: 'farm', at: site });
    const run = (cash: number) => planGoals({ context: planning,
      goals: [{ id: 'retained-capital', owner: 'us', effects: [effect], rewardGold: 10, deadlineTick: 5000, reasons: [] }],
      providers: [{ id: 'native-building-only', actionsFor: () => [action] }],
      initialBalances: [{ resource: { kind: 'gold' }, quantity: cash, asOfTick: snapshot.tick, factIds: [] }],
      declarationRevision: 'retained-capital', limits: { maxDepth: 8, maxExpansions: 64, maxPlans: 2 }, work: new FactWorkQueue(snapshot.tick) });
    const plan = run(BUILDING_DEFS.farm.cost).plans[0]!;
    expect(plan.status).toBe('ready'); expect(plan.costGold).toBe(0); expect(plan.valueGold).toBeGreaterThan(0);
    expect(plan.resourceTimeline.find(event => event.resource.kind === 'gold')).toMatchObject({ before: 120, delta: -120, after: 0 });
    expect(run(BUILDING_DEFS.farm.cost - 1).plans[0]!.readyActionIds).toEqual([]);
  });

  it('pays the exact native batch and replenishes the region pool without entity output slots', () => {
    const game = nativeScene(), snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
    const action = declareGoalTraining({ unitKind: 'footman', count: 2, producer: { kind: 'existing', entityId: 'barracks' },
      at, byTick: 2000 }, context(snapshot))!;
    expect(action.duration).toMatchObject({ state: 'met', value: UNIT_DEFS.footman.trainTime * 2 });
    expect(action.flows).toContainEqual(expect.objectContaining({ resource: { kind: 'gold' }, delta: -200, at: 'start' }));
    expect(action.flows).toContainEqual(expect.objectContaining({ resource: { kind: 'population-room' }, delta: -4, at: 'start' }));
    expect(action.outputs).toEqual([]);
    expect(action.cost).toMatchObject({ state: 'met', value: [{ code: 'training-asset-exchange', gold: 0 }] });
    expect(action.flows).toContainEqual(expect.objectContaining({ resource: { kind: 'unit-pool', unitKind: 'footman', at }, delta: 2 }));
    expect(action.flows.some(flow => flow.resource.kind === 'entity-control')).toBe(false);
    const goldBefore = game.players.us!.gold;
    for (let i = 0; i < 2; i++) expect(tryPlayerCommand(game, 'us', { type: 'train', buildingId: 'barracks', unitKind: 'footman' }).ok).toBe(true);
    expect(game.players.us!.gold).toBe(goldBefore - 200);
    for (let tick = 0; tick < UNIT_DEFS.footman.trainTime * 2; tick++) stepGame(game);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'footman')).toHaveLength(2);
    expect(action.flows.find(flow => flow.resource.kind === 'force')!.delta).toBeCloseTo(
      game.units.filter(unit => unit.owner === 'us' && unit.kind === 'footman').reduce((sum, unit) => sum + combatRating(unit), 0), 12);
    expect(game.buildings.find(building => building.id === 'barracks')!.queue).toEqual([]);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(declareGoalTraining({ unitKind: 'footman', count: 2, producer: { kind: 'existing', entityId: 'barracks' }, at,
      byTick: 2000 }, context(JSON.parse(before)))).toEqual(action);
  });

  it('keeps native tier capacity separate from free population; a real completed farm unlocks the knight', () => {
    const game = nativeScene(), snapshot = snapshotGame(game);
    const action = declareGoalTraining({ unitKind: 'knight', count: 1, producer: { kind: 'existing', entityId: 'stables' },
      at: { ...at, point: { x: 650, y: 650 } }, byTick: 2400 }, context(snapshot))!;
    expect(action.preconditions.map(fact => fact.predicate)).toContainEqual({ kind: 'supply-cap', minimum: requiredSupplyCap('knight') });
    expect(action.preconditions.map(fact => fact.predicate)).toContainEqual({ kind: 'population-room', minimum: UNIT_DEFS.knight.supplyUsed, byTick: 2400 });
    expect(game.players.us!.supplyCap).toBe(56);
    expect(tryPlayerCommand(game, 'us', { type: 'train', buildingId: 'stables', unitKind: 'knight' }).ok).toBe(false);
    expect(tryPlayerCommand(game, 'us', { type: 'build', unitId: 'worker', buildingKind: 'farm', ...site.point }).ok).toBe(true);
    for (let ticks = 0; ticks < 400 && game.players.us!.supplyCap < requiredSupplyCap('knight'); ticks++) stepGame(game);
    expect(game.players.us!.supplyCap).toBe(62);
    expect(tryPlayerCommand(game, 'us', { type: 'train', buildingId: 'stables', unitKind: 'knight' }).ok).toBe(true);
  });

  it('uses the same train declaration for a transport and keeps a future producer symbolic', () => {
    const snapshot = snapshotGame(nativeScene()), producer = { kind: 'output', actionId: 'a-build-yard', output: 'building' } as const;
    const ship = declareGoalTraining({ unitKind: 'transport', count: 1, producer,
      at: { seaId: 'sea:1', point: { x: 1000, y: 1000 } }, byTick: 5000 }, context(snapshot))!;
    expect(ship.kind).toBe('train');
    expect(ship.demands[0]!.resource).toEqual({ kind: 'production-lane', producer, lane: 'training' });
    expect(ship.flows.find(flow => flow.resource.kind === 'gold')!.delta).toBe(-UNIT_DEFS.transport.cost);
    expect(ship.preconditions.find(fact => fact.predicate.kind === 'spawn-exit')!.predicate).toMatchObject({ producer });
    expect(ship.outputs).toEqual([]);
    expect(ship.effects.find(effect => effect.fact.predicate.kind === 'transport-in')!.fact.predicate)
      .toMatchObject({ kind: 'transport-in', seaId: 'sea:1' });
    expect(ship.effects.find(effect => effect.fact.predicate.kind === 'transport-in')!.fact.predicate).not.toHaveProperty('transport');
    expect(declareGoalTraining({ unitKind: 'knight', count: 1, producer: { kind: 'existing', entityId: 'barracks' }, at, byTick: 5000 }, context(snapshot))).toBeNull();
    snapshot.players.us!.race = 'ember';
    expect(declareGoalTraining({ unitKind: 'knight', count: 1, producer, at, byTick: 5000 }, context(snapshot))).toBeNull();
  });

  it('uses the native rally input for exit proof instead of the same-region pool anchor', () => {
    const snapshot = snapshotGame(nativeScene()), producer = snapshot.buildings.find(building => building.id === 'barracks')!;
    producer.rallyTarget = { type: 'unit', unitId: 'worker' };
    const action = declareGoalTraining({ unitKind: 'footman', count: 1, producer: { kind: 'existing', entityId: producer.id }, at, byTick: 5000 }, context(snapshot))!;
    expect(action.preconditions.find(fact => fact.predicate.kind === 'spawn-exit')!.predicate).toMatchObject({ toward: { point: worker.from.point } });
    expect(action.preconditions.find(fact => fact.predicate.kind === 'unit-available')).toBeUndefined();
    expect(action.effects.find(effect => effect.fact.predicate.kind === 'unit-available')!.fact.predicate).toMatchObject({ at });
  });

  it('charges a new foundation once, includes the shared walk, and emits capacity only on completion', () => {
    const snapshot = snapshotGame(nativeScene()), action = declareGoalBuilding({ buildingKind: 'farm', at: site, worker, byTick: 5000 }, context(snapshot, road))!;
    expect(action.duration).toMatchObject({ state: 'met', value: 15 + BUILDING_DEFS.farm.buildTime });
    expect(action.flows).toContainEqual(expect.objectContaining({ resource: { kind: 'gold' }, delta: -120, at: 'start' }));
    expect(action.flows).toContainEqual(expect.objectContaining({ resource: { kind: 'supply-cap' }, delta: 6, at: 'finish' }));
    expect(action.effects).toContainEqual({ fact: goalFact({ kind: 'build-site', buildingKind: 'farm', at: site }), operation: 'invalidate', at: 'start' });
    const safety = goalFact({ kind: 'site-safe', site, throughTick: snapshot.tick + 15 + BUILDING_DEFS.farm.buildTime });
    expect(action.preconditions).toContainEqual(safety);
    expect(action.preconditionWindows).toContainEqual({ factId: safety.id, through: 'finish' });
    const foundation = createBuilding('started', 'us', 'farm', site.point.x, site.point.y, false);
    foundation.buildProgress = 40; snapshot.buildings.push(foundation);
    const resume = declareGoalBuilding({ buildingKind: 'farm', at: site, worker, byTick: 5000, foundationId: 'started' }, context(snapshot, road))!;
    expect(resume.flows.find(flow => flow.resource.kind === 'gold')!.delta).toBe(0);
    expect(resume.duration).toMatchObject({ state: 'met', value: 15 + foundation.buildTime - 40 });
    expect(resume.preconditions.some(fact => fact.predicate.kind === 'gold' || fact.predicate.kind === 'build-site')).toBe(false);
    expect(resume.outputs).toEqual([]);
    expect(declareGoalBuilding({ buildingKind: 'farm', at: { ...site, landId: 'land:2' }, worker, byTick: 5000 }, context(snapshot, road))).toBeNull();
    expect(declareGoalBuilding({ buildingKind: 'fortifiedTower', at: site, worker, byTick: 5000 }, context(snapshot, road))).toBeNull();
  });

  it('retains a pending construction route instead of zero walk or an impossible site', () => {
    const ctx = context(snapshotGame(nativeScene()), fact => ({ ...road(fact), state: 'pending', requestId: 'route-request', requestedTick: 0 }));
    const action = declareGoalBuilding({ buildingKind: 'shipyard', at: site, worker, byTick: 5000 }, ctx)!;
    expect(action.duration).toMatchObject({ state: 'pending', requestIds: ['route-request'] });
    expect(action.preconditions.some(fact => fact.predicate.kind === 'route')).toBe(true);
    expect(action.preconditions.some(fact => fact.predicate.kind === 'build-site')).toBe(true);
    const safety = action.preconditions.find(fact => fact.predicate.kind === 'site-safe')!;
    expect(safety.predicate).toMatchObject({ throughTick: ctx.tick });
    expect(action.preconditionWindows).toContainEqual({ factId: safety.id, through: 'finish' });
  });

  it('binds every supplied safety proof to construction finish and retimes all ID references after a delayed start', () => {
    const snapshot = snapshotGame(nativeScene()), old = [goalFact({ kind: 'site-safe', site, throughTick: 5000 }),
      goalFact({ kind: 'shore-safe', landId: 'land:1', landing: site, throughTick: 6000 }),
      goalFact({ kind: 'assets-safe', unitIds: ['worker'], at: site, throughTick: 7000 })];
    const action = declareGoalBuilding({ buildingKind: 'farm', at: site, worker, byTick: 5000,
      additionalPreconditions: old }, context(snapshot, road))!;
    const finish = snapshot.tick + 15 + BUILDING_DEFS.farm.buildTime;
    const safety = action.preconditions.filter(fact => 'throughTick' in fact.predicate);
    expect(safety).toHaveLength(3);
    expect(safety.every(fact => 'throughTick' in fact.predicate && fact.predicate.throughTick === finish)).toBe(true);
    expect(action.preconditionWindows).toHaveLength(3);
    expect(action.cost.state === 'met' && action.cost.value[0]!.factIds).toContain(safety.find(fact => fact.predicate.kind === 'site-safe')!.id);
    const delayed = retimeGoalActionPreconditions(JSON.parse(JSON.stringify(action)), finish + 100)!;
    expect(delayed.preconditions.filter(fact => 'throughTick' in fact.predicate)
      .every(fact => 'throughTick' in fact.predicate && fact.predicate.throughTick === finish + 100)).toBe(true);
    for (const fact of old) expect(JSON.stringify(delayed)).not.toContain(JSON.stringify(fact.id).slice(1, -1));
    expect(delayed.id).toBe(action.id);
    expect(delayed.effects).toEqual(action.effects);
    expect(delayed.flows.find(flow => flow.resource.kind === 'gold')!.delta).toBe(-BUILDING_DEFS.farm.cost);
  });

  it('declares the new producer capability on the same symbolic building output', () => {
    const snapshot = snapshotGame(nativeScene()), action = declareGoalBuilding({ buildingKind: 'barracks', at: site, worker, byTick: 5000 }, context(snapshot, road))!;
    const producer = { kind: 'output', actionId: action.id, output: 'building' } as const;
    expect(action.effects.map(effect => effect.fact.predicate)).toContainEqual({ kind: 'production', unitKind: 'footman', producer, at: site, byTick: 5000 });
    expect(action.flows).toContainEqual(expect.objectContaining({ resource: { kind: 'production-lane', producer, lane: 'training' }, delta: 1, at: 'finish' }));
    expect(action.effects.map(effect => effect.fact.predicate).some(predicate => predicate.kind === 'supply-cap')).toBe(false);
    expect(action.preconditions.map(fact => fact.predicate.kind)).not.toContain('production');
  });

  it('credits only incremental, supported income and never substitutes current cash for forecast epoch', () => {
    const snapshot = snapshotGame(nativeScene()), effect = goalFact({ kind: 'gold', minimum: 400, byTick: 500 });
    const read = (fact: GoalFact): GoalFactObservation => ({ ...road(fact), availableTick: 300,
      goldForecast: { epoch: snapshot.tick, currentFreeGold: 325, goldAtDeadline: 450, earliestTick: 300, incomeGoldPerTick: .25,
        factIds: ['income'], source: { kind: 'income', id: 'shared-income-us', segments: [{ fromTick: 0, throughTick: 500, ratePerTick: .25 }] } } });
    const action = declareGoalWaitIncome(effect, context(snapshot, read))!;
    expect(action.duration).toMatchObject({ state: 'met', value: 300 });
    expect(action.flows).toEqual([{ resource: { kind: 'gold' }, delta: 75, at: 'finish', factIds: ['income'],
      source: { kind: 'income', id: 'shared-income-us', segments: [{ fromTick: 0, throughTick: 300, ratePerTick: .25 }] } }]);
    expect(declareGoalWaitIncome(effect, context({ ...snapshot, tick: 1 }, read))).toBeNull();
    const noIncome = (fact: GoalFact): GoalFactObservation => ({ ...read(fact), goldForecast: { ...read(fact).goldForecast!, goldAtDeadline: 350, earliestTick: null,
      source: { kind: 'income', id: 'shared-income-us', segments: [{ fromTick: 0, throughTick: 100, ratePerTick: .25 }] } } });
    const partial = declareGoalWaitIncome(effect, context(snapshot, noIncome))!;
    expect(partial.duration).toMatchObject({ state: 'met', value: 100 });
    expect(partial.flows[0]!.delta).toBe(25);
    expect(partial.effects[0]!.fact.predicate).toEqual({ kind: 'gold', minimum: 350, byTick: 500 });
    const stopped = (fact: GoalFact): GoalFactObservation => ({ ...read(fact), goldForecast: { ...read(fact).goldForecast!, goldAtDeadline: 325, earliestTick: null } });
    expect(declareGoalWaitIncome(effect, context(snapshot, stopped))).toBeNull();
    const lower = declareGoalWaitIncome(goalFact({ kind: 'gold', minimum: 350, byTick: 500 }), context(snapshot, read))!;
    const projection = projectGoalResources({ epoch: 0, initial: [{ resource: { kind: 'gold' }, quantity: 325, asOfTick: 0, factIds: [] }],
      actions: [{ action: lower, startTick: 0, finishTick: 100 }, { action, startTick: 0, finishTick: 300 }] });
    expect(projection.state).toBe('met');
    if (projection.state !== 'pending') expect(projection.balances.find(balance => balance.resource.kind === 'gold')!.quantity).toBe(400);
  });

  it('uses typed facts without native routing or mutating the scene', () => {
    const snapshot = snapshotGame(nativeScene()), before = JSON.stringify(snapshot), events: string[] = [];
    const ctx = context(snapshot, road);
    withNavigationAudit(event => { events.push(event.operation); throw Error('Unmetered declaration navigation'); },
      () => withNavigationPhase('strategy-planning', () => {
        const build = declareGoalBuilding({ buildingKind: 'townHall', at: site, worker, byTick: 5000 }, ctx)!;
        const extra = goalFact({ kind: 'camp-cleared', campId: 'camp-binding' });
        const alias = declareGoalBuilding({ buildingKind: 'townHall', at: site, worker, byTick: 5000, additionalPreconditions: [extra] }, ctx)!;
        expect(alias.id).not.toBe(build.id);
        expect(declareGoalTraining({ unitKind: 'worker', count: 1, producer: { kind: 'existing', entityId: 'hall' }, at, byTick: 5000 }, ctx)).not.toBeNull();
      }));
    expect(events).toEqual([]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
