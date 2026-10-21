import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import { sketchScene } from '../../sdk/scene';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { planAiOwnerCommandEntries, type AiOwnerPlannerOptions } from '../planner-context';
import * as situation from './situation';
import * as voyageRisk from './allocation-voyage-risk';
import * as allocationQuery from './allocation-arrival-query';
import * as arrivals from './arrivals';
import * as conquest from './conquest-methods';
import * as defense from './defense-methods';
import type { BootstrapStrategyOutput } from './bootstrap-control';

type Frame = { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory; nextId: number; activePlayers: string[] };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plan = (frame: Frame, options: AiOwnerPlannerOptions = {}) => planAiOwnerCommandEntries(frame.snapshot,
  { playerId: frame.owner, version: frame.owner === 'p0' ? 'v9_knight' : 'v9_summoner', memory: frame.memory }, { strategyControl: true, ...options });
afterEach(() => vi.restoreAllMocks());

describe('the real bootstrap control entry before behavioral acceptance', () => {
  it('runs an ordinary attack objective through the ready plan bundle, actual grant and public command frame', () => {
    const game = sketchScene('owner-goal-command-authority').map('bareDuel').replaceDefaults()
      .player('us', { team: 'us' }).player('foe', { team: 'foe' })
      .townHall('us', 700, 1000, { id: 'home' }).townHall('foe', 1050, 1000, { id: 'enemy-site', hp: 20 })
      .unit('us', 'footman', 1000, 1000, { id: 'fighter' }).build().createGame();
    game.scriptedVictory = true;
    const snapshot = snapshotGame(game), before = digest(snapshot), memory = createAiPolicyMemory();
    let output: BootstrapStrategyOutput | undefined;
    const entries = withNavigationAudit(event => {
      if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
    }, () => withNavigationPhase('strategy-planning', () => planAiOwnerCommandEntries(snapshot,
      { playerId: 'us', version: 'v9_knight', memory }, { strategyControl: true,
        observeBootstrapPlan(_context, _entries, actual) { output = actual; } })));
    const command = entries.find(entry => entry.scriptId === 'goal.destroy-target');
    expect(command?.command).toMatchObject({ type: 'attack', unitIds: ['fighter'], targetId: 'enemy-site' });
    const authority = memory.strategyAllocation!, lease = authority.leases['unit:fighter']!;
    expect(authority.methods[lease.methodId]!.kind).toBe('goal-plan');
    expect(authority.executions[lease.action.actionId]!.executor).toBe('goal.destroy-target');
    expect(output!.goalPlanner!.readyActions.some(row => row.action.declaration.kind === 'destroy-target')).toBe(true);
    expect(digest(snapshot)).toBe(before);
    issueCommandFrame(game, entries);
    expect(game.units.find(unit => unit.id === 'fighter')!.order).toEqual({ type: 'attack', targetId: 'enemy-site' });
  });
  it('does not evacuate the safe idle worker in the first erroneous continuous grant frame', () => {
    const source: Frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/gullIsland-control-3630.json.gz', import.meta.url))).toString());
    const frame = structuredClone(source), original = structuredClone(source);
    const worker = frame.snapshot.units.find(unit => unit.id === 'unit-p0-worker-1012')!;
    expect(worker.order).toEqual({ type: 'idle' });
    expect(frame.snapshot.buildings.find(building => building.id === 'building-p0-townHall-1167')?.complete).toBe(true);
    let output: BootstrapStrategyOutput | undefined;
    const commands = plan(frame, { observeBootstrapPlan(_context, _entries, actual) { output = actual; } });
    const baseline = plan(original, { strategyControl: false });
    expect(commands.some(entry => entry.scriptId === 'strategy.evacuate')).toBe(false);
    expect(frame.memory.strategyAllocation!.leases[`unit:${worker.id}`]).toBeUndefined();
    expect(Object.values(frame.memory.strategyAllocation!.leases).filter(lease => lease.origin === 'allocator')).toEqual([]);
    expect(commands).toEqual(baseline);
    const defended = output!.decision.objectives.find(objective => objective.id === 'DefendSite:p0:building-p0-townHall-1167');
    expect(defended?.status).toBe('active'); // the collector preserves the ordinary observer's objective
    expect(output!.goalPlanner!.readyActions.some(row => row.action.declaration.kind === 'evacuate')).toBe(false);
  }, 60000);
  it.each(['gullIsland-p0-9930', 'Ne-sapphireArchipelago-player-4-17991'])('evaluates %s once and projects the same accepted think', name => {
    const numerical = structuredClone(frames[name]!), observed = structuredClone(frames[name]!);
    const snapshotBefore = digest(numerical.snapshot), evaluator = vi.spyOn(situation, 'evaluateSituation');
    const batch = vi.spyOn(voyageRisk, 'prepareAllocationVoyageRisks'), oldQuery = vi.spyOn(allocationQuery, 'withAllocationArrivalQuery');
    const query = vi.spyOn(arrivals, 'createArrivalQuery'), oldConquest = vi.spyOn(conquest.conquestMethodProvider, 'buildMethods'),
      oldDefense = vi.spyOn(defense.defenseMethodProvider, 'buildMethods');
    const commands = plan(numerical);
    const work = numerical.memory.strategy!.observation.factWork!;
    expect(work.used).toBeLessThanOrEqual(6144);
    expect(work.services.reduce((sum, service) => sum + service.work, 0)).toBe(work.used);
    expect(evaluator).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledTimes(0); expect(oldQuery).toHaveBeenCalledTimes(0); expect(query).toHaveBeenCalledTimes(1);
    let output: BootstrapStrategyOutput | undefined;
    const visible = plan(observed, { observeBootstrapPlan(_context, _entries, actual) { output = actual; } });
    expect(evaluator).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledTimes(0); expect(oldQuery).toHaveBeenCalledTimes(0); expect(query).toHaveBeenCalledTimes(2);
    expect(oldConquest).not.toHaveBeenCalled(); expect(oldDefense).not.toHaveBeenCalled();
    expect(visible).toEqual(commands);
    expect(JSON.stringify(observed.memory)).toBe(JSON.stringify(numerical.memory));
    expect(digest(numerical.snapshot)).toBe(snapshotBefore);
    const beforeProjection = JSON.stringify(observed.memory);
    expect(output?.project).toBeDefined();
    const trace = output!.project!();
    expect(trace.mode).toBe('control');
    expect(output!.decision.mode).toBe('control');
    expect(output!.goalPlanner).toBeDefined();
    expect(output!.goalPlanner!.cache).toEqual(observed.memory.goalPlanning!.cache);
    expect(output!.candidateRequests?.every(request => request.methodId.startsWith('goal-bundle:'))).toBe(true);
    for (const request of output!.candidateRequests ?? []) for (const id of request.unitIds)
      expect(output!.decision.situation.units.find(unit => unit.id === id)?.hp).toBeGreaterThan(0);
    expect(trace.allocation?.revision).toBe(observed.memory.strategyAllocation!.revision);
    expect(JSON.stringify(observed.memory)).toBe(beforeProjection);
    expect(evaluator).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledTimes(0); expect(oldQuery).toHaveBeenCalledTimes(0); expect(query).toHaveBeenCalledTimes(2);
    expect(oldConquest).not.toHaveBeenCalled(); expect(oldDefense).not.toHaveBeenCalled();
    // An unquoted cold route is still unknown. This entry test does not call
    // absence of a grant a successful recall or conquest.
    expect(output!.goalPlanner!.plans.some(plan => ['waiting-facts', 'search-pending', 'blocked'].includes(plan.status))).toBe(true);
  }, 60000);

  it('continues the native E01 world with identical authority after a JSON fork', () => {
    const frame = structuredClone(frames['gullIsland-p0-9930']!), first = plan(frame);
    const game = createGame(frame.snapshot.map.id, { players: frame.activePlayers });
    restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId); game.activePlayers = [...frame.activePlayers];
    issueCommandFrame(game, first);
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    frame.snapshot = snapshotGame(game);
    const fork: Frame = JSON.parse(JSON.stringify(frame));
    const warm = plan(frame), cold = plan(fork);
    expect(JSON.stringify(cold)).toBe(JSON.stringify(warm));
    expect(JSON.stringify(fork.memory)).toBe(JSON.stringify(frame.memory));
    expect(digest(fork.snapshot)).toBe(digest(frame.snapshot));
  }, 60000);

  it('retains the ordinary room path as an explicit comparison while control is opt-in', () => {
    const ordinary = structuredClone(frames['gullIsland-p0-9930']!), defaultOff = structuredClone(ordinary), controlled = structuredClone(ordinary);
    const original = plan(ordinary, { strategyControl: false });
    const baseline = planAiOwnerCommandEntries(defaultOff.snapshot,
      { playerId: defaultOff.owner, version: 'v9_knight', memory: defaultOff.memory });
    plan(controlled);
    // Default/off retains the ordinary policy. A cold controlled planner no
    // longer starts another old strategic mission while its facts are pending.
    expect(Object.keys(controlled.memory.strategyAllocation!.leases)).toEqual([]);
    expect(baseline).toEqual(original);
    expect(defaultOff.memory).toEqual(ordinary.memory);
    expect(ordinary.memory.strategyAllocation).toBeUndefined();
  }, 60000);
});
