import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import { currentFactWork, FactWorkQueue } from './fact-work';
import { goalFact } from './goal-facts';
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

it('produces a real training-ready declaration after shared publication in diagnostic geometry measurement', () => {
  const game = scene(), goal = request(game);
  let memory: AiPolicyMemory = createAiPolicyMemory(), ready = false;
  for (let think = 0; think < 60 && !ready; think++) {
    if (think) for (let step = 0; step < 15; step++) stepGame(game);
    const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
    const output = strict(() => planOwnerGoals({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [goal], geometryMeasurement: true }));
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

it('advances diagnostic owner publication through JSON thinks while the complete native snapshot stays frozen', () => {
  const game = scene(), snapshot = snapshotGame(game), before = JSON.stringify(snapshot), goal = request(game);
  let memory = createAiPolicyMemory(), ready = false;
  for (let sequence = 1; sequence <= 10 && !ready; sequence++) {
    const output = strict(() => planOwnerGoals({ snapshot, owner: 'us', version: 'v9_summoner', memory, goals: [goal], geometryMeasurement: true }));
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

it('retains diagnostic geometry outside the legacy observation trimmer and migrates older memories', () => {
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
