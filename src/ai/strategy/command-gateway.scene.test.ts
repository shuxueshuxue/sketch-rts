import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame } from '../../shared/sim';
import { standingBodies } from '../../shared/structure-bodies';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameCommand, GameSnapshot } from '../../shared/types';
import { issueCommandFrame } from '../../sdk/commands/frame';
import type { AiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AllocationEvent, ExecutorInput, StrategyAllocationMemory } from './allocation-types';
import { admitStrategyCommands, type StrategyCommandProposal } from './command-gateway';
import { createStrategyAllocationMemory } from './control';
import { buildStrategyDecision } from './decision';
import { defenseMethodProvider } from './defense-methods';
import { defendSiteExecutor } from './executors/defend-site';

type Frame = { owner: string; snapshot: GameSnapshot; memory: AiPolicyMemory; nextId: number; activePlayers: string[] };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
const recalled = [1687, 1720, 2015, 2047, 2066, 2094].map(id => `unit-p0-emberRavager-${id}`);
let frame: Frame, request: ExecutorInput, memory: StrategyAllocationMemory;

function proposal(command: GameCommand, source: 'script' | 'executor' = 'executor', purpose: 'task' | 'life-saving' = 'task'): StrategyCommandProposal {
  return { id: `${source}:${command.type}`, source, executor: source === 'script' ? 'naval' : request.execution.executor,
    action: source === 'script' ? null : request.execution.token,
    allocationRevision: source === 'script' ? null : request.grant.revision, purpose, command };
}
function admit(proposals: readonly StrategyCommandProposal[], authority = memory, grant = request.grant) {
  return admitStrategyCommands({ snapshot: frame.snapshot, owner: frame.owner, memory: authority, grants: [grant], proposals, queuedTick: null });
}

describe('one resource authority at the real E01 home raid', () => {
  beforeAll(() => {
    frame = structuredClone(frames['gullIsland-p0-9930']!);
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    const decision = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
    const objective = decision.objectives.find(goal => goal.id === 'DefendSite:p0:building-p0-townHall-1166')!;
    const method = defenseMethodProvider.buildMethods({ snapshot: frame.snapshot, situation: decision.situation,
      objective, previous: null, executions: [], blocked: [] }).find(method => method.kind === 'main-army-recall')!;
    const action = method.actions.at(-1)!, token = { actionId: action.id, generation: 1 };
    const event: AllocationEvent = { id: 'preemption:E01', tick: frame.snapshot.tick, revision: 1,
      objectiveId: 'old-ferry', methodId: 'old-ferry', action: { actionId: 'old-ferry', generation: 0 },
      kind: 'preempted', handoff: 'pause', reason: { code: 'home-raid-has-higher-marginal-value', factIds: [], values: {} },
      quotation: { fromObjectiveId: 'old-ferry', toObjectiveId: objective.id, resourceKeys: recalled.map(id => `unit:${id}` as const),
        marginalBenefitGold: 800, displacedLossGold: 100, switchingCostGold: 10,
        reason: { code: 'confirmed-incumbent-handoff', factIds: [], values: {} } } };
    request = { snapshot: frame.snapshot, owner: frame.owner, objective, method, events: [event],
      execution: { token, objectiveId: objective.id, methodId: method.id, executor: action.executor, intent: action.intent,
        target: action.target, dependsOn: [], completionEffects: action.completionEffects, status: 'active', phase: 'gather',
        sinceTick: frame.snapshot.tick, lastProgressTick: frame.snapshot.tick, state: {} },
      grant: { revision: 1, action: token, objectiveId: objective.id, methodId: method.id,
        leases: recalled.map(id => ({ id: `lease:${id}`, resourceKey: `unit:${id}`, objectiveId: objective.id,
          methodId: method.id, action: token, sinceTick: frame.snapshot.tick, minimumStayUntilTick: frame.snapshot.tick,
          origin: 'allocator', incumbentTask: null })), assignments: [], budgets: [], voyages: [], orders: [], commands: [],
        orderOverrides: recalled.map(unitId => ({ unitId, preemptionEventId: event.id, previousCommandId: null })) } };
    memory = { ...createStrategyAllocationMemory(frame.owner, frame.snapshot.tick), revision: 1,
      executions: { [action.id]: request.execution }, leases: Object.fromEntries(request.grant.leases.map(lease => [lease.resourceKey, lease])),
      events: [event] };
  });

  it('rejects the competing ferry command and applies only the granted recall to the six boarding units', () => {
    const before = JSON.stringify({ frame, memory, request });
    const unit = frame.snapshot.units.find(unit => unit.id === recalled[0])!;
    if (unit.order.type !== 'board') throw new Error('E01 fixture no longer contains its real boarding order');
    const old = proposal({ type: 'board', unitIds: [...recalled], transportId: unit.order.transportId }, 'script');
    const callbacks: (readonly GameCommand[])[] = [];
    const oldEntries = runAiCommandEntriesFromScripts(frame.snapshot, frame.owner,
      [{ id: 'naval', phase: 'tactics', run: () => old.command, onCommands: (_snapshot, _owner, _options, commands) => callbacks.push(commands) }],
      { memory: structuredClone(frame.memory) }, { admitCommands: (_script, commands) => admit(commands.map(command => ({ ...old, command }))).accepted.map(item => item.command) });
    expect(oldEntries).toEqual([]);
    expect(callbacks).toEqual([[]]);
    const formal = defendSiteExecutor.execute(request).commands.map((entry, i) => ({ ...proposal(entry.command), id: `recall:${i}` }));
    const result = admit([old, ...formal]);
    expect(result.admissions[0]).toMatchObject({ source: 'script', executor: 'naval', status: 'rejected',
      reason: { reason: 'resource-leased-to-another-action' } });
    expect(result.accepted.map(item => item.command)).toEqual(formal.map(item => item.command));
    const game = createGame(frame.snapshot.map.id, { players: frame.activePlayers });
    restoreSnapshotIntoGame(game, structuredClone(frame.snapshot), frame.nextId);
    game.activePlayers = [...frame.activePlayers];
    issueCommandFrame(game, result.accepted.map(item => ({ playerId: frame.owner, scriptId: item.executor, command: item.command })));
    expect(game.units.filter(unit => recalled.includes(unit.id)).map(unit => unit.order.type)).toEqual(recalled.map(() => 'move'));
    expect(JSON.stringify({ frame, memory, request })).toBe(before);
  });

  it('does not bypass old boarding protection until the incumbent acknowledges the exact resource handoff', () => {
    const command = proposal({ type: 'move', unitIds: [recalled[0]!], ...request.execution.target.point });
    const pending = { ...memory, events: memory.events.map(event => event.kind === 'preempted' ? { ...event, handoff: 'pending' as const } : event) };
    expect(admit([command], pending).admissions[0]).toMatchObject({ status: 'rejected', reason: { reason: 'board-handoff-unconfirmed' } });
    expect(admit([command], memory, { ...request.grant, orderOverrides: [] }).accepted).toEqual([]);
    expect(admit([command]).accepted).toHaveLength(1);
  });

  it('applies the same authority to follow, ungranted hulls, stale revisions and forged executor names', () => {
    const targetId = frame.snapshot.units.find(unit => unit.owner === frame.owner && !recalled.includes(unit.id))!.id;
    expect(admit([proposal({ type: 'follow', unitIds: [...recalled], targetId }, 'script')]).accepted).toEqual([]);
    const formal = proposal({ type: 'stop', unitIds: [recalled[0]!] });
    expect(admit([{ ...formal, allocationRevision: 0 }]).accepted).toEqual([]);
    expect(admit([{ ...formal, action: { ...formal.action!, generation: 0 } }]).accepted).toEqual([]);
    expect(admit([{ ...formal, executor: 'naval' }]).accepted).toEqual([]);
    const unit = frame.snapshot.units.find(unit => unit.id === recalled[0])!;
    if (unit.order.type !== 'board') throw new Error('missing real board order');
    expect(admit([proposal({ type: 'board', unitIds: [unit.id], transportId: unit.order.transportId })]).admissions[0])
      .toMatchObject({ status: 'rejected', reason: { reason: 'command-dependent-resource-not-granted' } });
  });

  it('collects a life-saving interruption before admitting task commands, in either proposal order', () => {
    const task = proposal({ type: 'move', unitIds: [recalled[0]!], ...request.execution.target.point });
    const rescue = proposal({ type: 'stop', unitIds: [recalled[0]!] }, 'executor', 'life-saving');
    for (const proposals of [[task, rescue], [rescue, task]]) {
      const result = admit(proposals);
      expect(result.accepted).toEqual([rescue]);
      expect(result.admissions.find(item => item.commandId === task.id)).toMatchObject({ status: 'rejected',
        reason: { reason: 'life-saving-interruption-replaces-task' } });
    }
  });

  it('preserves the free part of old bulk orders, and reproduces the same transaction after JSON restore', () => {
    const free = frame.snapshot.units.find(unit => unit.owner === frame.owner && unit.hp > 0 && !recalled.includes(unit.id))!;
    const proposals = [proposal({ type: 'follow', unitIds: [recalled[0]!, free.id], targetId: recalled[1]! }, 'script')];
    const result = admit(proposals);
    expect(result.accepted[0]?.command).toEqual({ ...proposals[0]!.command, unitIds: [free.id] });
    const cold = JSON.parse(JSON.stringify({ snapshot: frame.snapshot, owner: frame.owner, memory, grants: [request.grant], proposals, queuedTick: null }));
    expect(JSON.stringify(admitStrategyCommands(cold))).toBe(JSON.stringify(result));
  });
});
