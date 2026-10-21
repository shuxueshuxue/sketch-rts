import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import { currentFactWork, FactWorkQueue } from './fact-work';
import { createStrategyAllocationMemory } from './control';
import { goalCampId, goalFact } from './goal-facts';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { planOwnerGoals, withGoalPlannerInput } from './goal-planner-input';
import { planGoals } from './goal-planner';
import type { GoalRequest } from './goal-planner-types';
import { landIdAt, regionIndex } from './regions';
import { situationConstructionCount } from './situation';

function scene() {
  const game = sketchScene('real-goal-input-assembly').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: 3000 })
    .townHall('us', 350, 350).townHall('foe', 4000, 4000)
    .building('us', 'barracks', 350, 650, { id: 'producer' }).worker('us', 450, 350).build().createGame();
  game.scriptedVictory = true; regionIndex(game.map); return game;
}
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
function request(game: ReturnType<typeof scene>): GoalRequest {
  const at = { point: { x: 350, y: 650 }, landId: landIdAt(game.map, { x: 350, y: 650 })! };
  return { id: 'one-footman', owner: 'us', effects: [goalFact({ kind: 'unit-available', unitKind: 'footman', count: 1, at, byTick: 10000 })],
    rewardGold: 2000, deadlineTick: 10000, reasons: [] };
}

it('assembles native inputs and search inside one Situation/query/work scope without issuing a command', () => {
  const game = scene(), snapshot = snapshotGame(game), memory = createAiPolicyMemory(), work = new FactWorkQueue(snapshot.tick, 0);
  const before = JSON.stringify(snapshot), count = situationConstructionCount();
  const output = strict(() => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [request(game)], work }, input => {
    expect(currentFactWork()).toBe(work); expect(input.work).toBe(work);
    expect(input.context.situation.tick).toBe(snapshot.tick);
    expect(input.initialBalances.find(balance => balance.resource.kind === 'gold')!.quantity).toBe(game.players.us!.gold);
    return planGoals(input);
  }));
  expect(situationConstructionCount() - count).toBe(1);
  expect(work.receipt.used).toBe(0); expect(output.readyActions).toEqual([]);
  expect(memory.strategyAllocation).toBeUndefined(); expect(JSON.stringify(snapshot)).toBe(before);
});

it('produces a real training-ready declaration after shared publication within the calibrated default geometry capacity', () => {
  const game = scene(), goal = request(game);
  let memory: AiPolicyMemory = createAiPolicyMemory(), ready = false;
  for (let think = 0; think < 60 && !ready; think++) {
    if (think) for (let step = 0; step < 15; step++) stepGame(game);
    const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
    const output = strict(() => planOwnerGoals({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [goal] }));
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
    expect(memory.strategyAllocation).toBeUndefined();
    if (output.readyActions.length) {
      expect(output.readyActions.map(item => item.action.declaration.kind)).toEqual(['train']);
      expect(output.readyActions[0]!.action.declaration.executor.parameters).toMatchObject({ unitKind: 'footman', count: 1,
        producer: { kind: 'existing', entityId: 'producer' } });
      ready = true;
    }
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(ready).toBe(true);
  expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'footman')).toHaveLength(0);
});

it('advances owner publication through JSON thinks while the complete native snapshot stays frozen', () => {
  const game = scene(), snapshot = snapshotGame(game), before = JSON.stringify(snapshot), goal = request(game);
  let memory = createAiPolicyMemory(), ready = false;
  for (let sequence = 1; sequence <= 10 && !ready; sequence++) {
    const output = strict(() => planOwnerGoals({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [goal] }));
    const receipt = memory.strategy!.observation.factWork!;
    expect(receipt).toMatchObject({ tick: snapshot.tick, thinkSequence: sequence });
    expect(receipt.used).toBeLessThanOrEqual(6144);
    expect(receipt.services.reduce((sum, item) => sum + item.work, 0)).toBe(receipt.used);
    ready = output.readyActions.some(item => item.action.declaration.kind === 'train');
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(ready).toBe(true);
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(memory.strategyAllocation).toBeUndefined();
});

it('keeps continued native cross-sea observations inside the shared physical facts on later frozen thinks', () => {
  const frame: { snapshot: import('../../shared/types').GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const before = JSON.stringify(frame.snapshot);
  let memory = frame.memory ?? createAiPolicyMemory();
  for (let think = 0; think < 6; think++) {
    strict(() => planOwnerGoals({ snapshot: frame.snapshot, owner: frame.owner, version: 'v9_summoner', memory }));
    expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
    expect(JSON.stringify(frame.snapshot)).toBe(before);
    memory = JSON.parse(JSON.stringify(memory));
  }
});

it('retains diagnostic geometry outside the older observation trimmer and migrates older memories', () => {
  const game = scene(), snapshot = snapshotGame(game), memory = createAiPolicyMemory();
  const entry = { key: 'previous-geometry', revision: 'old', state: 0, work: 1, requestedTick: 0,
    readyTick: 0, value: [], planIds: ['retired-plan'] };
  withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [] }, () => {});
  memory.strategy!.observation.goalGeometry = { version: 1, entries: [entry] };
  delete memory.goalPlanning!.geometry;
  withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [], geometryMeasurement: true }, () => {});
  expect(memory.strategy!.observation.goalGeometry).toBeUndefined();
  expect(memory.goalPlanning!.geometry!.capacity!.mode).toBe('measurement');
  expect(memory.goalPlanning!.geometry!.entries.find(item => item.key === entry.key)).toMatchObject({ readyTick: 0 });
  expect(memory.goalPlanning!.geometry!.entries.find(item => item.key === entry.key)!.planIds).toBeUndefined();
});

it('composes actual safety and combat candidates in the same native owner scope without pricing unobserved risk', () => {
  const game = scene(), snapshot = snapshotGame(game), memory = createAiPolicyMemory();
  const at = { point: { x: 350, y: 350 }, entityId: snapshot.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!.id,
    landId: landIdAt(snapshot.map, { x: 350, y: 350 })! };
  const quiet = goalFact({ kind: 'site-safe', site: at, throughTick: 100 });
  const before = JSON.stringify(snapshot), count = situationConstructionCount();
  strict(() => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [], geometryMeasurement: true }, input => {
    expect(input.context.readFact(quiet)).toMatchObject({ state: 'met', reason: { code: 'observed-safety-window-clear' } });
    const move = goalFact({ kind: 'worker-at', at, count: 1, byTick: 100 });
    const candidates = input.context.grounding!.combatOptions!(move);
    expect(candidates.state).toBe('met');
    if (candidates.state === 'met') {
      expect(candidates.candidates.length).toBeGreaterThan(0);
      expect(candidates.candidates.every(candidate => candidate.cost.state === 'pending')).toBe(true);
      expect(candidates.candidates[0]!.cohort).toEqual([{ kind: 'existing', entityId: snapshot.units.find(unit => unit.kind === 'worker')!.id }]);
    }
  }));
  expect(situationConstructionCount() - count).toBe(1); expect(JSON.stringify(snapshot)).toBe(before);
  expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
});

it('publishes a physical local march and its observed no-exposure proof without inventing a risk number', () => {
  const game = scene(), snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const at = { point: { x: 700, y: 350 }, landId: landIdAt(snapshot.map, { x: 700, y: 350 })! };
  const fact = goalFact({ kind: 'worker-at', at, count: 1, byTick: 1200 });
  let memory = createAiPolicyMemory(), known = false;
  for (let sequence = 1; sequence <= 10 && !known; sequence++) {
    strict(() => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [] }, input => {
      const options = input.context.grounding!.combatOptions!(fact);
      if (options.state !== 'met') return;
      for (const option of options.candidates) if (option.cost.state === 'met' && option.successProbability.state === 'met') {
        expect(option.duration.state).toBe('met');
        expect(option.cost.value.map(term => term.gold)).toEqual([0]); expect(option.successProbability.value).toBe(1);
        expect(option.preconditions.every(route => input.context.readFact(route).state === 'met')).toBe(true);
        known = true;
      }
    }));
    expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(known).toBe(true); expect(JSON.stringify(snapshot)).toBe(before);
});

it('requotes a producer delay on the same native Situation and work ledger without escaping its scope', () => {
  const game = scene(), snapshot = snapshotGame(game), goal = request(game), before = JSON.stringify(snapshot);
  let memory = createAiPolicyMemory(), known = false;
  let escaped: import('./goal-planner-input').GoalPlannerNativeFrame | undefined;
  for (let sequence = 1; sequence <= 20 && !known; sequence++) {
    const count = situationConstructionCount();
    strict(() => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [goal] }, (input, frame) => {
      escaped = frame;
      const gross = planGoals(input); memory.goalPlanning!.cache = gross.cache;
      if (!gross.readyActions.length) return;
      const plan = gross.plans[0]!, requoted = frame.requote({ unitIds: [], valuation: { phase: 'gross',
        unavailableProduction: [{ buildingId: 'producer', lane: 'training', fromTicks: 0, throughTicks: 100 }] } }, plan);
      if (requoted.state !== 'known') return;
      expect(requoted.plan.actions.find(action => action.declaration.kind === 'train')!.startTick).toBeGreaterThanOrEqual(100);
      expect(requoted.plan.costGold).toBe(plan.costGold);
      expect(requoted.plan.valueGold).toBeLessThan(plan.valueGold!);
      known = true;
    }));
    expect(situationConstructionCount() - count).toBe(1);
    expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(known).toBe(true); expect(JSON.stringify(snapshot)).toBe(before);
  expect(() => escaped!.resolveReference({ kind: 'existing', entityId: 'producer' })).toThrow('outside its owner-think scope');
});

it('dispatches native land combat and camp staging through their domain readers in the one owner scope', () => {
  const snapshot = snapshotGame(sketchScene('native-domain-composition').map('bareDuel').replaceDefaults()
    .player('us', { team: 'us' }).player('foe', { team: 'foe' })
    .townHall('us', 700, 1000, { id: 'home' }).townHall('foe', 1050, 1000, { id: 'enemy-site', hp: 20 })
    .unit('us', 'footman', 1000, 1000, { id: 'fighter' })
    .unit('neutral', 'ogreWarrior', 2000, 2000, { id: 'guard' }).build().createGame());
  regionIndex(snapshot.map);
  const memory = createAiPolicyMemory(), before = JSON.stringify(snapshot), count = situationConstructionCount();
  const landId = landIdAt(snapshot.map, { x: 1000, y: 1000 })!;
  const target = { entityId: 'enemy-site', landId, point: { x: 1050, y: 1000 } };
  const campId = goalCampId(neutralCampExposure(snapshot).camps[0]!.memberIds);
  strict(() => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory, goals: [] }, input => {
    const options = input.context.grounding!.combatOptions!(goalFact({ kind: 'enemy-site-destroyed', site: target }));
    expect(options.state).toBe('met');
    if (options.state === 'met') {
      expect(options.candidates).toHaveLength(1);
      expect(options.candidates[0]).toMatchObject({ target, post: { point: { x: 1000, y: 1000 } },
        cohort: [{ kind: 'existing', entityId: 'fighter' }] });
    }
    const staging = input.context.readFact(goalFact({ kind: 'camp-staging', campId,
      at: { landId, point: { x: 1500, y: 1500 } }, cohort: [{ kind: 'existing', entityId: 'fighter' }] }));
    expect(staging.reason.code).not.toBe('world-domain-port-required');
    expect(staging.reason.code).toMatch(/staging/);
  }));
  expect(situationConstructionCount() - count).toBe(1);
  expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('reads executor free gold after this think reserves capital and rejects another authority epoch', () => {
  const game = scene(), snapshot = snapshotGame(game), memory = createAiPolicyMemory();
  strict(() => withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory, goals: [] }, (input, frame) => {
    const fact = goalFact({ kind: 'gold', minimum: 400, byTick: snapshot.tick });
    expect(input.context.readFact(fact).state).toBe('met');
    const authority: import('./allocation-types').StrategyAllocationMemory = {
      ...createStrategyAllocationMemory('us', snapshot.tick), evaluatedTick: snapshot.tick,
      budgets: { hall: { id: 'hall', spendId: 'hall', objectiveId: 'other-goal', methodId: 'other-method',
        action: { actionId: 'build', generation: 1 }, amountGold: 2800, paidGold: 0, state: 'reserved',
        sinceTick: snapshot.tick, releasedTick: null, includedUtilityTermCodes: [], externalReservationIds: [] } } };
    expect(frame.executionFacts(authority)(fact)).toMatchObject({ state: 'unmet', quantity: 200, observedTick: snapshot.tick });
    expect(() => frame.executionFacts({ ...authority, evaluatedTick: snapshot.tick - 1 })).toThrow('epoch mismatch');
    expect(input.context.readFact(fact).state).toBe('met'); // allocation never rewrites the earlier planning observation
  }));
});
