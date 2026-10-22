import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { withNavigationAudit } from '../../shared/navigation-audit';
import type { BootstrapStrategyOutput } from './bootstrap-control';
import { continuedIncumbentScripts } from './incumbent-scripts';
import { createStrategyAllocationMemory } from './control';
import { createStrategyCommandGateway } from './command-gateway';
import { bindIncumbentCommands } from './incumbent-command-source';
import type { AiScript } from '../policy/types';
import type { StrategyAllocationMemory } from './allocation-types';

it('does not start the original public island ferry while the controlled plan awaits facts', () => {
  const snapshot: GameSnapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-far.json.gz', import.meta.url))).toString());
  const before = JSON.stringify(snapshot), memory = createAiPolicyMemory();
  let output: BootstrapStrategyOutput | undefined;
  const entries = withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
  }, () => planAiOwnerCommandEntries(snapshot, { playerId: 'planner', version: 'v9_knight', memory },
    { strategyControl: true, observeBootstrapPlan(_context, _entries, actual) { output = actual; } }));
  expect(output!.goalPlanner!.plans.some(plan => plan.status === 'waiting-facts')).toBe(true);
  expect(entries.filter(entry => ['naval', 'v6General'].includes(entry.scriptId))).toEqual([]);
  expect(Object.keys(memory.naval?.ferries ?? {})).toEqual([]);
  expect(memory.landExpansion).toBeUndefined();
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('runs local services and only the strategic producer of an actual imported task', () => {
  const run = () => [], scripts: AiScript[] = [
    { id: 'naval', phase: 'tactics', redirects: 'strategic', run },
    { id: 'v6General', phase: 'tactics', redirects: 'local', run },
    { id: 'frontRecovery', phase: 'tactics', redirects: 'local', run },
    { id: 'v6Economy', phase: 'economy', run },
  ];
  const authority = createStrategyAllocationMemory('us', 0);
  expect(continuedIncumbentScripts(scripts, authority).map(script => script.id)).toEqual(['frontRecovery', 'v6Economy']);
  const action = { actionId: 'voyage', generation: 1 };
  const actual: StrategyAllocationMemory = { ...authority,
    executions: { voyage: { token: action, objectiveId: 'old', methodId: 'old-method', executor: 'naval', intent: { kind: 'recover' },
      target: { point: { x: 10, y: 20 } }, dependsOn: [], completionEffects: [], status: 'active', phase: 'imported-execution',
      sinceTick: 0, lastProgressTick: 0, state: {} } },
    leases: { 'unit:ship': { id: 'ship-lease', resourceKey: 'unit:ship', action, objectiveId: 'old', methodId: 'old-method',
      sinceTick: 0, minimumStayUntilTick: 0, origin: 'imported-task', incumbentTask: { source: 'naval.ferries', taskId: 'actual' } } } };
  expect(continuedIncumbentScripts(scripts, actual).map(script => script.id)).toEqual(['naval', 'frontRecovery', 'v6Economy']);
  const snapshot = { players: { us: { gold: 0 } }, units: [{ id: 'ship', owner: 'us', hp: 1 }, { id: 'free', owner: 'us', hp: 1 }],
    buildings: [] } as unknown as GameSnapshot;
  const commands = bindIncumbentCommands([{ type: 'move' as const, unitIds: ['ship', 'free'], x: 10, y: 20 }],
    { source: 'naval.ferries', taskId: 'actual' });
  const admitted = createStrategyCommandGateway({ snapshot, owner: 'us', memory: actual, grants: [], queuedTick: null,
    incumbentOnlyScripts: new Set(['naval']) }).admit(commands.map(command => ({ id: 'continue', source: 'script', executor: 'naval',
      action: null, allocationRevision: null, purpose: 'task', command })));
  expect(admitted.accepted.map(row => row.command)).toEqual([{ type: 'move', unitIds: ['ship'], x: 10, y: 20 }]);
  expect(admitted.admissions.find(row => row.status === 'rejected')?.command).toMatchObject({ unitIds: ['free'] });
  const other = bindIncumbentCommands([{ type: 'move' as const, unitIds: ['ship'], x: 100, y: 200 }],
    { source: 'naval.ferries', taskId: 'new-mission' });
  expect(createStrategyCommandGateway({ snapshot, owner: 'us', memory: actual, grants: [], queuedTick: null,
    incumbentOnlyScripts: new Set(['naval']) }).admit(other.map(command => ({ id: 'new', source: 'script', executor: 'naval',
      action: null, allocationRevision: null, purpose: 'task', command }))).accepted).toEqual([]);
});

it('grants the original four fighters before any old ferry can occupy them', () => {
  const initial: GameSnapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-far.json.gz', import.meta.url))).toString());
  const game = createGame(initial.map.id, { players: Object.keys(initial.teams!) });
  restoreSnapshotIntoGame(game, initial, 1001); game.activePlayers = Object.keys(initial.teams!); game.scriptedVictory = true;
  const fighterIds = initial.units.filter(unit => unit.owner === 'planner' && unit.kind === 'footman').map(unit => unit.id).sort();
  let memory = createAiPolicyMemory(), issued = false;
  for (let think = 1; think <= 12; think++) {
    const entries = withNavigationAudit(event => {
      if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
    }, () => planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'planner', version: 'v9_knight', memory }, { strategyControl: true }));
    expect(Object.keys(memory.naval?.ferries ?? {})).toEqual([]);
    expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
    const moves = entries.flatMap(entry => entry.scriptId === 'goal.assemble' && entry.command.type === 'move' ? [entry.command] : []);
    issueCommandFrame(game, entries);
    if (moves.flatMap(command => command.unitIds).sort().join() === fighterIds.join()) {
      for (const id of fighterIds) {
        const lease = memory.strategyAllocation!.leases[`unit:${id}`]!;
        expect(lease.origin).toBe('allocator');
        expect(memory.strategyAllocation!.executions[lease.action.actionId]!.executor).toBe('goal.assemble');
        expect(game.units.find(unit => unit.id === id)!.order.type).toBe('move');
      }
      issued = true; break;
    }
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect(issued).toBe(true);
}, 60000);
