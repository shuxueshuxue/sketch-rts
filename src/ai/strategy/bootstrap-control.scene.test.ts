import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries, type AiOwnerPlannerOptions } from '../planner-context';
import * as situation from './situation';
import type { BootstrapStrategyOutput } from './bootstrap-control';

type Frame = { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory; nextId: number; activePlayers: string[] };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const policy = (memory: AiPolicyMemory) => { const { strategy, strategyAllocation, ...old } = memory; return old; };
const plan = (frame: Frame, options: AiOwnerPlannerOptions = {}) => planAiOwnerCommandEntries(frame.snapshot,
  { playerId: frame.owner, version: frame.owner === 'p0' ? 'v9_knight' : 'v9_summoner', memory: frame.memory }, { strategyControl: true, ...options });
afterEach(() => vi.restoreAllMocks());

describe('the real bootstrap control entry before behavioral acceptance', () => {
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
    expect(defended?.status).toBe('complete');
    expect(defended?.reasons.map(reason => reason.code)).toContain('current-site-threat-cleared');
  }, 60000);
  it.each(['gullIsland-p0-9930', 'Ne-sapphireArchipelago-player-4-17991'])('evaluates %s once and projects the same accepted think', name => {
    const numerical = structuredClone(frames[name]!), observed = structuredClone(frames[name]!);
    const snapshotBefore = digest(numerical.snapshot), evaluator = vi.spyOn(situation, 'evaluateSituation');
    const commands = plan(numerical);
    expect(evaluator).toHaveBeenCalledTimes(1);
    let output: BootstrapStrategyOutput | undefined;
    const visible = plan(observed, { observeBootstrapPlan(_context, _entries, actual) { output = actual; } });
    expect(evaluator).toHaveBeenCalledTimes(2);
    expect(visible).toEqual(commands);
    expect(JSON.stringify(observed.memory)).toBe(JSON.stringify(numerical.memory));
    expect(digest(numerical.snapshot)).toBe(snapshotBefore);
    const beforeProjection = JSON.stringify(observed.memory);
    expect(output?.project).toBeDefined();
    const trace = output!.project!();
    expect(trace.mode).toBe('control');
    expect(output!.decision.mode).toBe('control');
    expect(output!.candidateRequests?.some(request => request.phase === 'skeleton')).toBe(true);
    expect(output!.candidateRequests?.some(request => request.phase === 'gross')).toBe(true);
    for (const request of output!.candidateRequests ?? []) for (const id of request.unitIds)
      expect(output!.decision.situation.units.find(unit => unit.id === id)?.hp).toBeGreaterThan(0);
    expect(trace.allocation?.revision).toBe(observed.memory.strategyAllocation!.revision);
    expect(JSON.stringify(observed.memory)).toBe(beforeProjection);
    expect(evaluator).toHaveBeenCalledTimes(2);
    // An unquoted cold route is still unknown. This entry test does not call
    // absence of a grant a successful recall or conquest.
    expect(observed.memory.strategyAllocation!.unmet.some(item => item.reason.code.includes('unknown'))).toBe(true);
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
    const ordinary = structuredClone(frames['gullIsland-p0-9930']!), controlled = structuredClone(ordinary);
    const original = plan(ordinary, { strategyControl: false }), candidate = plan(controlled);
    // This first cold frame has no feasible formal grant. The old producers
    // keep their behavior instead of converting a missing quote into zero.
    expect(Object.keys(controlled.memory.strategyAllocation!.leases)).toEqual([]);
    expect(candidate).toEqual(original);
    expect(policy(controlled.memory)).toEqual(policy(ordinary.memory));
    expect(ordinary.memory.strategyAllocation).toBeUndefined();
  }, 60000);
});
