import { originalPolicyMemory } from './strategy/observation-memory';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runGameLoop } from '../sdk/game-runner';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../shared/sim';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from './planner-context';
import type { AiPolicyMemory } from './memory';
import type { AiGameAgent } from './game-runner';
import type { BootstrapAiVersion, GameSnapshot } from '../shared/types';
import { buildAiPlanTrace, type AiPlanTrace } from './plan-trace';
import { planAiOwnerCommandEntriesWithTrace } from './plan-trace-planner';

function frozen<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}
function example() {
  const game = createGame('bareDuel', { aiPlayers: [] }), snapshot = snapshotGame(game);
  snapshot.tick = 100;
  const unit = snapshot.units.find(unit => unit.owner === 'player')!, mine = snapshot.resources[0]!;
  const memory: AiPolicyMemory = { jobs: [], unitClaims: {
    [unit.id]: { kind: 'expansionMission', targetId: mine.id, expansionMineId: mine.id,
      x: mine.x, y: mine.y, sinceTick: 80, expiresTick: 90 },
  }, landExpansion: { mineId: mine.id, sinceTick: 80, stage: 'escort', paused: true,
    interruptions: [{ tick: 95, reason: 'home-threat' }] }, naval: {
    ferries: { [unit.id]: { purpose: 'settle', targetId: mine.id, from: { x: unit.x, y: unit.y },
      to: { x: mine.x, y: mine.y }, phase: 'loading', crewIds: [unit.id], sinceTick: 85 } },
    ferryDecisions: { [unit.id]: { tick: 100, reason: 'no-combat-crew', lastBlock: { tick: 100, reason: 'no-combat-crew' } } },
  } };
  return { snapshot, memory, unit, mine };
}

describe('read-only AI plan trace', () => {
  it('projects actual blocked state and ownership without inventing utility or a reservation ledger', () => {
    const { snapshot, memory, unit } = example();
    const trace = buildAiPlanTrace(frozen(snapshot), 'player', frozen(memory), 'v9_archer');
    const root = trace.nodes.find(node => node.source === 'landExpansion')!;
    expect(root.status).toBe('blocked');
    expect(root.reasons[0]?.code).toBe('home-threat');
    expect(root.resources.unitIds).toEqual([unit.id]);
    expect(root.utility).toEqual({ score: null, source: 'not-recorded', terms: [] });
    expect(root.resources.gold).toEqual({ reserved: null, required: 400 });
    expect(trace.nodes.some(node => node.source === 'naval.ferries' && node.status === 'blocked')).toBe(true);
    expect(trace.nodes.some(node => node.label === '护送工程队')).toBe(true);
    // A stage enum is not an execution history. Do not fabricate earlier completed or later blocked subgoals.
    expect(trace.nodes.some(node => node.label === '修建分矿')).toBe(false);
    const ids = new Set(trace.nodes.map(node => node.id));
    expect(ids.size).toBe(trace.nodes.length);
    expect(trace.nodes.flatMap(node => node.children).every(id => ids.has(id))).toBe(true);
    expect(trace.roots.filter(id => !ids.has(id))).toEqual([]);
  });

  it('distinguishes completion, abandonment, disappearance and actual changes across thinks', () => {
    const { snapshot, memory } = example();
    const first = buildAiPlanTrace(snapshot, 'player', memory, 'v9_knight');
    snapshot.tick += 15;
    delete memory.landExpansion!.paused;
    memory.landExpansion!.stage = 'complete';
    const second = buildAiPlanTrace(snapshot, 'player', memory, 'v9_knight', first);
    expect(second.previousTick).toBe(first.tick);
    expect(second.changes).toContainEqual(expect.objectContaining({ kind: 'status', before: 'blocked', after: 'done' }));
    snapshot.tick += 15;
    delete memory.landExpansion;
    const third = buildAiPlanTrace(snapshot, 'player', memory, 'v9_knight', second);
    expect(third.changes.some(change => change.kind === 'removed' && change.before === 'done' && change.after === undefined)).toBe(true);
    memory.naval!.conquests = { lost: { mineId: 'lost', sinceTick: 90, stage: 'assemble', landing: { x: 100, y: 100 },
      reason: 'landing-party-lost', abandonedTick: 100, interruptions: [] } };
    expect(buildAiPlanTrace(snapshot, 'player', memory, 'v9_knight').nodes.find(node => node.kind === 'island')?.status).toBe('abandoned');
  });

  it('does not turn a historical ferry block into a current refusal, or expired claims into allocations', () => {
    const { snapshot, memory, unit } = example();
    memory.naval!.ferryDecisions![unit.id] = { tick: 100, reason: 'sailing', lastBlock: { tick: 90, reason: 'no-combat-crew' } };
    memory.unitClaims[unit.id]!.kind = 'mineGuard';
    delete memory.unitClaims[unit.id]!.expansionMineId;
    const trace = buildAiPlanTrace(snapshot, 'player', memory, 'v9_knight');
    expect(trace.nodes.find(node => node.source === 'naval.ferries')?.status).toBe('active');
    expect(trace.nodes.some(node => node.source === 'unitClaims.mineGuard')).toBe(false);
    expect(trace.nodes.find(node => node.source === 'landExpansion')?.resources.unitIds).toEqual([]);
  });

  it('preserves partially arrived groups and a ferry return destination without reporting the mine as its return shore', () => {
    const { snapshot, memory, unit, mine } = example();
    const other = snapshot.units.find(candidate => candidate.owner === 'player' && candidate.id !== unit.id)!;
    memory.unitClaims = {
      [unit.id]: { kind: 'mineRally', targetId: mine.id, x: mine.x, y: mine.y, sinceTick: 80, expiresTick: 200, arrived: true },
      [other.id]: { kind: 'mineRally', targetId: mine.id, x: mine.x, y: mine.y, sinceTick: 85, expiresTick: 200, arrived: false },
    };
    memory.naval!.ferries![unit.id]!.phase = 'return';
    const trace = buildAiPlanTrace(snapshot, 'player', memory, 'v9_archer');
    expect(trace.nodes.find(node => node.source === 'unitClaims.mineRally')?.reasons[0]).toMatchObject({ code: 'group-progress', detail: '1/2 名已到位；0 名正在回位' });
    expect(trace.nodes.find(node => node.source === 'naval.ferries')?.target).toEqual({ position: { x: unit.x, y: unit.y } });
  });

  it('detaches nested output and ignores previous data from a different owner or a future tick', () => {
    const { snapshot, memory, unit } = example();
    const saved = JSON.stringify({ snapshot, memory });
    const trace = buildAiPlanTrace(snapshot, 'player', memory, 'v9_archer');
    for (const node of trace.nodes) {
      if (node.target.position) node.target.position.x = -1;
      node.resources.unitIds.push('fake-observer-unit');
      node.reasons.push({ code: 'observer', detail: 'observer mutation', source: 'test' });
    }
    trace.bank.gold = -1;
    expect(JSON.stringify({ snapshot, memory })).toBe(saved);
    expect(memory.unitClaims[unit.id]).toBeDefined();
    expect(buildAiPlanTrace(snapshot, 'enemy', memory, 'v9_archer', trace).previousTick).toBeNull();
    expect(buildAiPlanTrace(snapshot, 'player', memory, 'v9_archer', trace).previousTick).toBeNull();
  });

  it.each(['v2', 'v2-prod', 'v9_archer'] as const)('preserves the ordinary %s planner with default and explicit memory', version => {
    const snapshot = snapshotGame(createGame('bareDuel', { aiPlayers: [] }));
    const plainMemory: AiPolicyMemory = { jobs: [], unitClaims: {} }, tracedMemory = structuredClone(plainMemory);
    const request = { playerId: 'player' as const, version, source: 'test' };
    const plain = planAiOwnerCommandEntries(structuredClone(snapshot), { ...request, memory: plainMemory });
    const traced = planAiOwnerCommandEntriesWithTrace(structuredClone(snapshot), { ...request, memory: tracedMemory });
    expect(JSON.stringify(traced.commands)).toBe(JSON.stringify(plain));
    expect(JSON.stringify(originalPolicyMemory(tracedMemory))).toBe(JSON.stringify(plainMemory));
    expect(traced.trace.plannerVersion).toBe(version);
    const defaultPlan = planAiOwnerCommandEntries(structuredClone(snapshot), request);
    expect(JSON.stringify(planAiOwnerCommandEntriesWithTrace(structuredClone(snapshot), request).commands)).toBe(JSON.stringify(defaultPlan));
  });

  it('observes an ephemeral memory without extra reads or writes to a read-only provider', () => {
    const { snapshot, mine } = example();
    let reads = 0;
    const result = planAiOwnerCommandEntriesWithTrace(snapshot, { playerId: 'player', version: 'v1', scripts: [{
      id: 'trace-ephemeral-memory', phase: 'tactics',
      run(_snapshot, _owner, context) {
        context.memory.landExpansion = { mineId: mine.id, sinceTick: snapshot.tick, stage: 'assemble', interruptions: [] };
        return undefined;
      },
    }] }, { memoryProvider: { get() { reads++; return undefined; } } });
    expect(reads).toBe(1);
    expect(result.trace.nodes.some(node => node.kind === 'expansion' && node.target.entityId === mine.id)).toBe(true);
  });

  it('emits one detached trace per think while preserving every command byte, memory and world in a real naval replay', () => {
    type Saved = { snapshot: GameSnapshot; nextId: number; memories: Record<string, AiPolicyMemory>; versions: Record<string, BootstrapAiVersion> };
    const saved: Saved = JSON.parse(readFileSync(new URL('./bootstrap_1/fixtures/ring-beachhead-15m.json', import.meta.url), 'utf8'));
    const replay = (traced: boolean) => {
      const game = createGame('bareDuel', { aiPlayers: [] });
      restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
      game.activePlayers = Object.keys(game.players);
      const memories = structuredClone(saved.memories), provider = createAiMemoryProvider(memories);
      const previous: Record<string, AiPlanTrace> = {}, commands: string[] = [], planned: string[] = [];
      let thinks = 0, traces = 0;
      const agents: Record<string, AiGameAgent> = Object.fromEntries(Object.entries(saved.versions).map(([id, version]) => [id,
        { controller: 'external-agent', team: game.teams[id] ?? id, race: game.players[id]!.race, version, policyVersion: version }]));
      runGameLoop({ name: 'trace-command-equivalence', game, agents, thinkInterval: 15, maxTicks: game.tick + 90,
        commandPlanner({ snapshot, owner, source, agent, teams }) {
          thinks++;
          const request = { playerId: owner, source, version: agent.version }, options = { memoryProvider: provider, teams };
          if (!traced) {
            const entries = planAiOwnerCommandEntries(snapshot, request, options);
            planned.push(JSON.stringify({ tick: snapshot.tick, owner, entries }));
            return entries;
          }
          const result = planAiOwnerCommandEntriesWithTrace(snapshot, request, options, previous[owner]);
          traces++;
          expect(result.trace.tick).toBe(snapshot.tick);
          expect(result.trace.owner).toBe(owner);
          previous[owner] = result.trace;
          planned.push(JSON.stringify({ tick: snapshot.tick, owner, entries: result.commands }));
          return result.commands;
        },
      }, { onCommand({ tick, owner, scriptId, command }) { commands.push(JSON.stringify({ tick, owner, scriptId, command })); } });
      return { planned: Buffer.from(planned.join('\n')), commands: Buffer.from(commands.join('\n')), memory: JSON.stringify(Object.fromEntries(Object.entries(memories).map(([owner, memory]) => [owner, originalPolicyMemory(memory)]))), world: JSON.stringify(snapshotGame(game)), thinks, traces };
    };
    const plain = replay(false), traced = replay(true);
    expect(traced.thinks).toBeGreaterThan(10);
    expect(traced.traces).toBe(traced.thinks);
    expect(traced.commands.length).toBeGreaterThan(0);
    expect(traced.planned.equals(plain.planned)).toBe(true);
    expect(traced.commands.equals(plain.commands)).toBe(true);
    expect(traced.memory).toBe(plain.memory);
    expect(traced.world).toBe(plain.world);
  }, 30000);
});
