import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import type { GameCommand, GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { createStrategyAllocationMemory, assertStrategyAllocationBounds } from './control';
import { bindIncumbentCommands, incumbentCommandActor } from './incumbent-command-source';
import { landExpansionActor, navalFerryActor } from './incumbent-actors';
import { incumbentDisposition, observeIncumbentOrders, recordCandidateReassignment, recordIncumbentCommands } from './incumbent-evidence';
import { handoffIncumbent } from './incumbent-handoff';

type Frame = { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory; nextId: number; activePlayers: string[] };
function frame(name: string): Frame { return JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames[name]; }

describe('actual incumbent execution and unstarted candidates', () => {
  it('keeps all four N(e) idle reservations proposed and emits candidate cleanup without a zero-priced preemption', () => {
    const f = frame('Ne-sapphireArchipelago-player-4-17991'), actor = landExpansionActor(f.memory.landExpansion!);
    const unitIds = [5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`);
    let memory = { ...createStrategyAllocationMemory(f.owner, f.snapshot.tick), revision: 1 };
    for (const id of unitIds) expect(incumbentDisposition(f.snapshot, f.snapshot.units.find(unit => unit.id === id)!, memory, actor)).toBe('proposed');
    expect(Object.keys(memory.leases)).toEqual([]);
    expect(handoffIncumbent(f.snapshot, f.owner, f.memory, actor, unitIds, 'candidate:1')?.disposition).toBe('pause');
    memory = recordCandidateReassignment({ memory, snapshot: f.snapshot, task: actor, unitIds, objectiveId: 'ConquerIsland:target',
      methodId: 'ConquerIsland:target/staged', action: { actionId: 'ConquerIsland:target/assemble', generation: 1 } });
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]).toMatchObject({ kind: 'candidate-reassigned', unitIds, repeatedUnitIds: [], reason: { code: 'candidate-reassigned' } });
    expect(memory.events.some(event => event.kind === 'preempted')).toBe(false);
    for (const id of unitIds) expect(f.memory.unitClaims[id]).toBeUndefined();
    const again = recordCandidateReassignment({ memory: { ...memory, revision: 3 }, snapshot: { ...f.snapshot, tick: f.snapshot.tick + 30 }, task: actor,
      unitIds, objectiveId: 'ConquerIsland:other', methodId: 'other/method', action: { actionId: 'other/assemble', generation: 2 } });
    expect(again.events.at(-1)).toMatchObject({ kind: 'candidate-reassigned', repeatedUnitIds: unitIds });
    expect(assertStrategyAllocationBounds(again)).toBeLessThan(256 * 1024);
    expect(JSON.stringify(recordCandidateReassignment({ memory: { ...JSON.parse(JSON.stringify(memory)), revision: 3 }, snapshot: { ...f.snapshot, tick: f.snapshot.tick + 30 },
      task: actor, unitIds, objectiveId: 'ConquerIsland:other', methodId: 'other/method', action: { actionId: 'other/assemble', generation: 2 } })))
      .toBe(JSON.stringify(again));
  });

  it('records only accepted producer commands, observes native boarding, and invalidates a real replacement order', () => {
    const f = frame('gullIsland-p0-9930'), unit = f.snapshot.units.find(unit => unit.id === 'unit-p0-emberRavager-1687')!;
    if (unit.order.type !== 'board') throw new Error('E01 boarding evidence changed');
    const ferry = f.memory.naval!.ferries![unit.order.transportId]!, actor = navalFerryActor(unit.order.transportId, ferry.sinceTick);
    let memory = createStrategyAllocationMemory(f.owner, f.snapshot.tick), sequence = 0;
    expect(incumbentDisposition(f.snapshot, unit, memory, actor)).toBe('unknown');
    const commands = bindIncumbentCommands([{ type: 'board' as const, unitIds: [unit.id], transportId: unit.order.transportId }], actor);
    const entries = runAiCommandEntriesFromScripts(f.snapshot, f.owner, [{ id: 'naval', phase: 'tactics', run: () => commands }], { memory: structuredClone(f.memory) },
      { onAdmittedCommands: (script, accepted) => { memory = recordIncumbentCommands(memory, f.snapshot, script.id, accepted, () => `accepted:${sequence++}`); } });
    expect(memory.incumbentOrders[unit.id]).toMatchObject({ executor: 'naval', task: actor, acceptedTick: f.snapshot.tick, observedTick: null });
    const game = createGame(f.snapshot.map.id, { players: f.activePlayers }); restoreSnapshotIntoGame(game, structuredClone(f.snapshot), f.nextId);
    game.activePlayers = [...f.activePlayers];
    issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: f.owner })));
    let snapshot = snapshotGame(game); memory = observeIncumbentOrders(memory, snapshot);
    expect(incumbentDisposition(snapshot, snapshot.units.find(unit => unit.id === commands[0]!.unitIds[0])!, memory, actor)).toBe('incumbent');
    issueCommandFrame(game, [{ playerId: f.owner, scriptId: 'replacement', command: { type: 'move', unitIds: [unit.id], x: unit.x, y: unit.y, avoidCombat: true } }]);
    snapshot = snapshotGame(game); memory = observeIncumbentOrders(memory, snapshot);
    expect(memory.incumbentOrders[unit.id]).toBeUndefined();
    expect(incumbentDisposition(snapshot, snapshot.units.find(candidate => candidate.id === unit.id)!, memory, actor)).toBe('unknown');
    expect(() => recordCandidateReassignment({ memory, snapshot, task: actor, unitIds: [unit.id], objectiveId: 'new', methodId: 'new/method',
      action: { actionId: 'new/action', generation: 1 } })).toThrow(/bypass/);
  });

  it('preserves source through order/claim splitting and leaves filtered proposals without a receipt', () => {
    const f = frame('gullIsland-p0-9930');
    const free = f.snapshot.units.filter(unit => unit.owner === f.owner && unit.order.type !== 'board').slice(0, 2);
    expect(free).toHaveLength(2);
    const task = { source: 'test-actual-branch', taskId: 'one-task' }, ids = free.map(unit => unit.id), commands: readonly GameCommand[] = bindIncumbentCommands([
      { type: 'move', unitIds: ids, x: free[0]!.x, y: free[0]!.y }], task);
    let memory = createStrategyAllocationMemory(f.owner, f.snapshot.tick);
    runAiCommandEntriesFromScripts(f.snapshot, f.owner, [
      { id: 'higher', phase: 'tactics', claimsUnits: () => new Set([ids[0]!]), run: () => [] },
      { id: 'producer', phase: 'tactics', run: () => [...commands] }], { memory: structuredClone(f.memory) },
    { onAdmittedCommands: (script, accepted) => {
      for (const command of accepted) expect(incumbentCommandActor(command)).toEqual(task);
      memory = recordIncumbentCommands(memory, f.snapshot, script.id, accepted, () => 'accepted:split');
    } });
    expect(memory.incumbentOrders[ids[0]!]).toBeUndefined();
    expect(memory.incumbentOrders[ids[1]!]?.command).toMatchObject({ type: 'move', unitIds: [ids[1]] });
  });
});
