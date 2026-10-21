import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createGame, stepGame, strikeUnit, tryPlayerCommand } from '../shared/sim';
import type { GameSnapshot, PlayerId } from '../shared/types';
import { AiDeathLedger } from './death-ledger';
import { deathTaskIndex, inferDeathAssignment, projectDeathThinkContext, sameDeathAssignmentGoal } from './death-ledger-context';
import { assignmentClearsCamp } from './death-ledger-engagement';
import { createAiPolicyMemory, type AiPolicyMemory } from './memory';
import { createStrategyAllocationMemory } from './strategy/control';
import type { ActionIntent, FormalAssignment, ResourceLease } from './strategy/allocation-types';
import { landIdAt } from './strategy/regions';
import samples from './fixtures/death-clearing-context.json';

function assign(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory, unitId: string, intent: ActionIntent,
  options: { objectiveId?: string; executor?: string } = {}) {
  const objectiveId = options.objectiveId ?? 'formal:site', methodId = `${objectiveId}:method`, action = { actionId: `${methodId}:act`, generation: 7 };
  const unit = snapshot.units.find(unit => unit.id === unitId)!;
  const target = { entityId: 'target', landId: landIdAt(snapshot.map, unit)!, point: { x: unit.x, y: unit.y } };
  const lease: ResourceLease = { id: `lease:${unitId}`, resourceKey: `unit:${unitId}`, objectiveId, methodId, action,
    sinceTick: snapshot.tick, minimumStayUntilTick: snapshot.tick + 300, origin: 'allocator', incumbentTask: null };
  const assignment: FormalAssignment = { authority: 'committed', id: `assignment:${unitId}`, leaseId: lease.id,
    unitId, role: 'frontline', objectiveId, methodId, action, target, stage: 'en-route',
    eta: { status: 'known', forecastTick: snapshot.tick, arrivalTick: snapshot.tick + 100 },
    lastLocation: { kind: 'land', landId: target.landId, point: target.point }, interruption: null };
  memory.strategyAllocation = { ...createStrategyAllocationMemory(owner, snapshot.tick), revision: 3,
    objectives: { [objectiveId]: { objectiveId, methodId, target, effectKeys: [], status: 'active',
      actionIds: [action.actionId], assignmentIds: [assignment.id], budgetIds: [], sinceTick: snapshot.tick,
      minimumStayUntilTick: snapshot.tick + 300, challengerId: null, challengerThinks: 0, committedUtilityGold: 321, force: null } },
    leases: { [lease.resourceKey]: lease }, assignments: { [assignment.id]: assignment },
    executions: { [action.actionId]: { token: action, objectiveId, methodId, executor: options.executor ?? 'strategy.defend-site',
      intent, target, dependsOn: [], completionEffects: [], status: 'active', phase: 'gather',
      sinceTick: snapshot.tick, lastProgressTick: snapshot.tick, state: {} } } };
  return { action, assignment, lease };
}

describe('formal allocation in the observation-only death ledger', () => {
  it('prefers the validated formal objective over the real E01 board order and keeps inferred candidates visible', () => {
    const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
      new URL('./bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['gullIsland-p0-9930'];
    const unit = frame.snapshot.units.find(unit => unit.id === 'unit-p0-emberRavager-1687')!;
    expect(unit.order.type).toBe('board');
    const { action, assignment } = assign(frame.snapshot, frame.owner, frame.memory, unit.id, { kind: 'defend-site' });
    const before = JSON.stringify(frame);
    const index = deathTaskIndex(frame.snapshot, frame.owner, frame.memory);
    const observed = inferDeathAssignment(frame.snapshot, unit, frame.memory, index, null);
    expect(observed).toMatchObject({ state: 'en-route', stateAttribution: 'assignment',
      task: { id: 'formal:site', attribution: 'assignment', formal: { action, assignmentId: assignment.id,
        allocationRevision: 3, plannedExecutor: 'strategy.defend-site' } } });
    expect(observed.otherTaskCandidates.some(task => task.kind === 'transport' && task.attribution === 'inferred')).toBe(true);
    const projected = projectDeathThinkContext(frame.snapshot, frame.owner, frame.memory);
    expect(JSON.parse(JSON.stringify(projected)).tasks.find(([id]: [string, unknown]) => id === unit.id)[1][0]).toEqual(observed.task);
    expect(JSON.stringify(frame)).toBe(before);
    const oldDefense = { ...observed.task!, id: 'defense:target', kind: 'mineRally', attribution: 'inferred' as const };
    delete oldDefense.formal;
    expect(sameDeathAssignmentGoal(oldDefense, observed.task)).toBe(true);
    expect(sameDeathAssignmentGoal({ ...observed.task!, id: 'another-formal-goal' }, observed.task)).toBe(false);
    const allocation = frame.memory.strategyAllocation!;
    frame.memory.strategyAllocation = { ...allocation, executions: { ...allocation.executions,
      [action.actionId]: { ...allocation.executions[action.actionId]!, token: { ...action, generation: action.generation + 1 } } } };
    expect(deathTaskIndex(frame.snapshot, frame.owner, frame.memory).byUnit.get(unit.id)?.some(task => task.attribution === 'assignment')).toBe(false);
  });

  it('allows only the formal active clearing target, never a stale inferred clearing candidate', () => {
    const sample = samples.find(sample => sample.sameCamp)!;
    const game = createGame('bareDuel', { aiPlayers: [] });
    const snapshot = { ...game, tick: sample.tick, units: [...sample.neutrals, sample.record.unit], buildings: [] } as unknown as GameSnapshot;
    const memory = Object.assign(createAiPolicyMemory(), structuredClone(sample.memory));
    const unit = snapshot.units.find(unit => unit.id === sample.record.unit.id)!, owner = unit.owner, killerId = sample.record.killer!.id;
    assign(snapshot, owner, memory, unit.id, { kind: 'deliver-force' });
    const infer = () => inferDeathAssignment(snapshot, unit, memory, deathTaskIndex(snapshot, owner, memory), null);
    expect(infer().otherTaskCandidates.some(task => task.clearing)).toBe(true);
    expect(assignmentClearsCamp(infer(), killerId)).toBe(false);
    const { action } = assign(snapshot, owner, memory, unit.id, { kind: 'clear-camp', memberIds: [killerId] });
    expect(assignmentClearsCamp(infer(), killerId)).toBe(true);
    expect(assignmentClearsCamp(infer(), 'another-camp-member')).toBe(false);
    const allocation = memory.strategyAllocation!;
    memory.strategyAllocation = { ...allocation, executions: { ...allocation.executions,
      [action.actionId]: { ...allocation.executions[action.actionId]!, status: 'blocked', phase: 'retreat' } } };
    expect(assignmentClearsCamp(infer(), killerId)).toBe(false);
  });

  it('records the actual killing event and native issuer separately from planned execution across the serialized think bridge', () => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    game.units = []; game.buildings = []; game.items = []; game.scriptedVictory = true; delete game.map.terrain;
    const unit = game.spawnUnit('player', 'footman', 500, 500), enemy = game.spawnUnit('enemy', 'footman', 600, 500);
    const memory = createAiPolicyMemory(), formal = assign(game, 'player', memory, unit.id, { kind: 'defend-site' });
    const direct = new AiDeathLedger(game, { owners: ['player'] }), threaded = new AiDeathLedger(game, { owners: ['player'] });
    const observe = () => { direct.recordThink(game, 'player', memory);
      threaded.recordThinkContext(JSON.parse(JSON.stringify(projectDeathThinkContext(game, 'player', memory)))); };
    try {
      observe();
      const command = { type: 'move' as const, unitIds: [unit.id], x: 800, y: 500, avoidCombat: true };
      tryPlayerCommand(game, 'player', command);
      for (const ledger of [direct, threaded]) ledger.recordIssuedCommand(game.tick, 'player', command, 'actual-native-issuer');
      const allocation = memory.strategyAllocation!;
      memory.strategyAllocation = { ...allocation, assignments: { [formal.assignment.id]: { ...formal.assignment,
        interruption: { kind: 'healing', executor: 'actual-native-issuer', sinceTick: game.tick,
          resumeStage: 'en-route', vacancyId: 'vacancy:1' } } } };
      observe();
      strikeUnit(game, enemy, unit, 99999, 'spell'); stepGame(game);
      expect(threaded.records()).toEqual(direct.records());
      expect(direct.records()[0]).toMatchObject({ assignment: { state: 'emergency-interruption', stateAttribution: 'assignment' },
        attributionContext: { provenance: 'assignment', objectiveId: 'formal:site', methodId: 'formal:site:method',
          assignmentId: formal.assignment.id, action: formal.action, allocationRevision: 3, plannedExecutor: 'strategy.defend-site',
          executor: 'actual-native-issuer', assignmentStage: 'life-saving-interruption' }, context: { retreating: true } });
      expect(direct.errors).toEqual([]); expect(threaded.errors).toEqual([]);
    } finally { direct.dispose(); threaded.dispose(); }
  });
});
