import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { BUILDING_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { goalFact } from './goal-facts';
import { readGoalIntent } from './goal-authority-references';
import { goalActionContributes, goalQuantity } from './goal-fact-matching';
import { goalPoolMemberCandidates } from './goal-pool-members';
import { createGoalEconomicGrounding } from './goal-economy-grounding';
import { goalEconomyActionProvider } from './goal-economy-provider';
import { withGoalPlannerInput } from './goal-planner-input';
import { planGoals } from './goal-planner';
import { createGoalPlanMethods } from './goal-plan-methods';
import { allocateStrategy } from './allocator';
import { createStrategyCommandGateway } from './command-gateway';
import { goalBuildExecutor } from './executors/goal-economy';
import { projectGoalResources } from './goal-resource-ledger';
import { landIdAt, regionIndex } from './regions';
import type { GoalActionDeclaration, GoalPoolMemberReference } from './goal-planner-types';
import type { Objective } from './types';

function game() {
  const game = sketchScene('worker-pool-command-contract').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'ember' }).playerState('us', { gold: BUILDING_DEFS.townHall.cost })
    .townHall('us', 400, 400, { id: 'home' }).worker('us', 1600, 1000, { id: 'builder' })
    .worker('us', 1500, 1000, { id: 'other' }).goldMine('new-mine', 1800, 1000, 40000).build().createGame();
  game.scriptedVictory = true; regionIndex(game.map); return game;
}

it('resolves only a real free regional pool member with the priced pose and movement profile', () => {
  const snapshot = snapshotGame(game()), unit = snapshot.units.find(unit => unit.id === 'builder')!;
  const at = { landId: landIdAt(snapshot.map, unit)!, point: { x: 1800, y: 1000 } };
  const reference: GoalPoolMemberReference = { kind: 'pool-member', unitKind: 'worker', at, slot: 'hall-builder',
    routeProfile: { from: { x: unit.x, y: unit.y }, speed: unit.speed } };
  expect(goalPoolMemberCandidates({ snapshot, owner: 'us', reference }).map(unit => unit.id)).toEqual(['builder']);
  expect(goalPoolMemberCandidates({ snapshot, owner: 'us', reference, excludedUnitIds: ['builder'] })).toEqual([]);
  expect(goalPoolMemberCandidates({ snapshot, owner: 'us', reference, interruptedUnitIds: ['builder'] })).toEqual([]);
  expect(goalPoolMemberCandidates({ snapshot, owner: 'us', reference, allowedUnitIds: ['other'] })).toEqual([]);
  expect(goalPoolMemberCandidates({ snapshot, owner: 'us', reference: { ...reference,
    routeProfile: { ...reference.routeProfile!, speed: unit.speed + 1 } } })).toEqual([]);
});

it('accounts transported worker supply and construction occupancy in one quantity pool, without passenger identity matching', () => {
  const snapshot = snapshotGame(game()), at = { landId: landIdAt(snapshot.map, { x: 1800, y: 1000 })!, point: { x: 1800, y: 1000 } };
  const worker = goalFact({ kind: 'worker-at', at, count: 1, byTick: 1000 });
  expect(goalQuantity(worker)).toMatchObject({ resource: { kind: 'unit-pool', unitKind: 'worker', at }, minimum: 1 });
  const atom = (id: string, kind: GoalActionDeclaration['kind'], flows: GoalActionDeclaration['flows']): GoalActionDeclaration => ({
    id, kind, preconditions: [], effects: [], demands: [], flows, duration: { state: 'met', value: 10, factIds: [] },
    cost: { state: 'met', value: [], factIds: [] }, successProbability: { state: 'met', value: 1, factIds: [] },
    executor: { executor: `goal.${kind}`, parameters: {} }, outputs: [], reasons: [] });
  // This is a pure quantity-ledger contract, not a transport or puzzle proof.
  const ferry = atom('actual-transport-declaration-shape', 'transport-worker', [
    { resource: { kind: 'unit-pool', unitKind: 'worker', at }, delta: 1, at: 'finish', factIds: ['native-transport-output'] },
  ]);
  expect(goalActionContributes(ferry, worker)).toBe(true);
  const build = atom('build', 'build', [
    { resource: { kind: 'unit-pool', unitKind: 'worker', at }, delta: -1, at: 'start', factIds: [worker.id] },
    { resource: { kind: 'unit-pool', unitKind: 'worker', at }, delta: 1, at: 'finish', factIds: [worker.id] },
  ]);
  const result = projectGoalResources({ epoch: 0, initial: [], actions: [
    { action: ferry, startTick: 0, finishTick: 100 }, { action: build, startTick: 100, finishTick: 200 },
  ] });
  expect(result.state).toBe('met'); if (result.state === 'pending') throw Error('Unexpected missing ledger');
  expect(result.timeline.map(row => [row.tick, row.after])).toEqual([[100, 1], [100, 0], [200, 1]]);
});

it('declares a coarse hall and its worker quantity without requesting exact geometry or a future passenger', () => {
  const snapshot = snapshotGame(game()), original = JSON.stringify(snapshot);
  const mine = snapshot.resources.find(resource => resource.id === 'new-mine')!;
  const at = { entityId: mine.id, landId: landIdAt(snapshot.map, mine)!, point: { x: mine.x, y: mine.y } };
  withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory: createAiPolicyMemory() }, input => {
    // Only the actual source's cached Situation is used. Every exact domain
    // port throws, including cohort discovery that might schedule a landing.
    const reject = () => { throw Error('Coarse building requested exact facts'); };
    const context = { ...input.context, precision: 'coarse' as const, readFact: reject };
    const grounding = createGoalEconomicGrounding(context, { geometry: reject, geometryRevision: 'unused-coarse',
      cohortOptions: reject, regionAt: point => landIdAt(snapshot.map, point) });
    const actions = goalEconomyActionProvider.actionsFor(goalFact({ kind: 'hall-complete', mineId: mine.id, at }),
      { ...context, grounding: { ...grounding, transportOptions: reject } });
    expect(actions).toHaveLength(1);
    const action = actions[0]!;
    expect(action.precision).toBe('coarse');
    expect(action.duration).toMatchObject({ state: 'met', value: BUILDING_DEFS.townHall.buildTime });
    expect(action.cost).toMatchObject({ state: 'met', value: [{ gold: 0 }] });
    expect(action.flows).toContainEqual(expect.objectContaining({ resource: { kind: 'gold' }, delta: -BUILDING_DEFS.townHall.cost, at: 'start' }));
    expect(action.preconditions.some(fact => fact.predicate.kind === 'worker-at' && fact.predicate.count === 1 && !fact.predicate.worker)).toBe(true);
    expect(action.preconditions.some(fact => fact.predicate.kind === 'route')).toBe(false);
    expect(action.executor.parameters.worker).toMatchObject({ kind: 'pool-member', unitKind: 'worker' });
  });
  expect(JSON.stringify(snapshot)).toBe(original);
});

it('selects an actual worker at the real owner scope, leases it and issues the exact native hall build command', () => {
  const native = game(), snapshot = snapshotGame(native), mine = snapshot.resources.find(resource => resource.id === 'new-mine')!;
  const at = { landId: landIdAt(snapshot.map, mine)!, point: { x: mine.x, y: mine.y }, entityId: mine.id };
  const goal = { id: 'hall-pool-contract', owner: 'us', effects: [goalFact({ kind: 'hall-complete', mineId: mine.id, at })],
    rewardGold: 2000, deadlineTick: 10000, reasons: [] };
  const objective: Objective = { id: goal.id, owner: 'us', kind: 'ExpandLand', target: at, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: null, evidence: [] },
    status: 'candidate', rank: null, sinceTick: 0, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
  let memory = createAiPolicyMemory(), selected = false;
  for (let sequence = 1; sequence <= 10 && !selected; sequence++) {
    withGoalPlannerInput({ snapshot, owner: 'us', version: 'v9_knight', memory, goals: [goal] }, (input, frame) => {
      const output = planGoals(input); memory.goalPlanning!.cache = output.cache;
      if (!output.readyActions.length) return;
      const declaration = output.readyActions[0]!.action.declaration;
      expect(declaration.kind).toBe('build'); expect(declaration.executor.parameters.worker).toMatchObject({ kind: 'pool-member' });
      expect(declaration.preconditions.some(fact => fact.predicate.kind === 'worker-at' && !fact.predicate.worker)).toBe(true);
      const bridge = createGoalPlanMethods({ snapshot, objectives: [objective], output, resolve: frame.resolveReference });
      const method = bridge.methods[0]!; expect(method).toBeDefined();
      const coarse = createGoalPlanMethods({ snapshot, objectives: [objective], output: { ...output,
        plans: output.plans.map(plan => ({ ...plan, actions: plan.actions.map(node => ({ ...node,
          declaration: { ...node.declaration, precision: 'coarse' as const } })) })) }, resolve: frame.resolveReference });
      expect(coarse.methods).toEqual([]);
      expect(coarse.deferred[0]?.reason.code).toBe('goal-selected-exact-refinement-pending');
      // Two distinct pool slots cannot both lease the sole worker matching
      // this exact priced route profile. Reusing parameters within one slot
      // above, however, resolves the same worker once.
      const plan = output.plans[0]!, first = plan.actions.find(node => node.id === plan.readyActionIds[0])!;
      const worker = first.declaration.executor.parameters.worker as GoalPoolMemberReference;
      const secondWorker = { ...worker, slot: `${worker.slot}:other` };
      const second = { ...first, id: `${first.id}:other`, declaration: { ...first.declaration, id: `${first.declaration.id}:other`,
        executor: { ...first.declaration.executor, parameters: { ...first.declaration.executor.parameters, worker: secondWorker } },
        demands: [{ resource: { kind: 'entity-control' as const, entity: secondWorker }, quantity: 1, from: 'start' as const, until: 'finish' as const }] } };
      const duplicate = createGoalPlanMethods({ snapshot, objectives: [objective], output: { ...output,
        plans: [{ ...plan, actions: [first, second], readyActionIds: [first.id, second.id] }] }, resolve: frame.resolveReference });
      expect(duplicate.methods).toEqual([]);
      expect(duplicate.deferred[0]?.reason.code).toBe('goal-ready-reference-unresolved');
      const allocated = allocateStrategy({ snapshot, situation: input.context.situation, objectives: [objective],
        methods: bridge.methods, providers: [bridge.provider], previous: null });
      expect(allocated.grants).toHaveLength(1);
      const grant = allocated.grants[0]!, execution = allocated.memory.executions[grant.action.actionId]!;
      expect(execution.intent.kind === 'goal-action' && readGoalIntent(allocated.memory, execution.intent).parameters.worker).toMatchObject({ kind: 'existing' });
      expect(grant.leases.filter(lease => lease.resourceKey.startsWith('unit:'))).toHaveLength(1);
      const feedback = goalBuildExecutor.execute({ snapshot, owner: 'us', objective, method, execution, grant, events: allocated.events, goalReferences: allocated.memory.goalReferences! });
      expect(feedback.commands).toHaveLength(1); expect(feedback.commands[0]!.command.type).toBe('build');
      const admitted = createStrategyCommandGateway({ snapshot, owner: 'us', memory: allocated.memory, grants: allocated.grants, queuedTick: null })
        .admit(feedback.commands.map((entry, index) => ({ id: `pool-build-${index}`, source: 'executor', executor: execution.executor,
          action: execution.token, allocationRevision: allocated.memory.revision, purpose: entry.purpose, command: entry.command })));
      expect(admitted.accepted).toHaveLength(1);
      issueCommandFrame(native, admitted.accepted.map(row => ({ playerId: 'us', scriptId: row.executor, command: row.command })));
      for (let tick = 0; tick < 150 && native.players.us!.gold === BUILDING_DEFS.townHall.cost; tick++) stepGame(native);
      expect(native.players.us!.gold).toBe(0);
      expect(native.buildings.some(building => building.kind === 'townHall' && building.id !== 'home' && building.owner === 'us')).toBe(true);
      selected = true;
    });
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(selected, 'native explicit hall contract became ready').toBe(true);
});
