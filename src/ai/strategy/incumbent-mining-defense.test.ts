import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { incumbentCommandActor } from './incumbent-command-source';
import { miningDefenseActor } from './incumbent-actors';
import { createStrategyAllocationMemory } from './control';
import { handoffIncumbent } from './incumbent-handoff';
import type { ResourceLease } from './allocation-types';

type Frame = { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(new URL(
  '../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
const saved: { snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory> } = JSON.parse(readFileSync(new URL(
  '../bootstrap_1/fixtures/defense-rally-14m48.json', import.meta.url), 'utf8'));
const rallyFrame = (): Frame => structuredClone({ snapshot: saved.snapshot, owner: 'v9_archer', memory: saved.memories.v9_archer! });
const plan = (frame: Frame) => planAiOwnerCommandEntries(frame.snapshot,
  { playerId: frame.owner, version: frame.owner === 'v9_archer' ? 'v9_archer' : 'v9_knight', memory: frame.memory });

function lease(frame: Frame, id: string, hallId: string, imported: boolean): ResourceLease {
  return { id: `lease:${id}`, resourceKey: `unit:${id}`, objectiveId: 'test:incumbent', methodId: 'test:method',
    action: { actionId: 'test:action', generation: 1 }, sinceTick: frame.snapshot.tick, minimumStayUntilTick: frame.snapshot.tick,
    origin: imported ? 'imported-task' as const : 'allocator' as const,
    incumbentTask: imported ? miningDefenseActor(hallId) : null };
}

describe('actual incumbent mining-defense producers', () => {
  it('marks only the actual general defense orders in the real 14:48 rally', () => {
    const frame = rallyFrame(), entries = plan(frame);
    const general = entries.filter(entry => entry.scriptId === 'v6General');
    expect(general).toHaveLength(2);
    expect(general.flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : [])).toHaveLength(19);
    for (const entry of general) expect(incumbentCommandActor(entry.command)).toEqual(miningDefenseActor('building-v9_archer-townHall-1602'));
    const cold = rallyFrame();
    expect(plan(cold)).toEqual(entries);
    expect(cold.memory).toEqual(frame.memory);
  });

  it('uses the same post actor for real E05 rally orders while the general attacks elsewhere', () => {
    const frame = structuredClone(frames['twoShores-p0-17790']!), entries = plan(frame);
    expect(frame.memory.v6?.general?.mode).toBe('attack');
    const rally = entries.filter(entry => entry.scriptId === 'miningRally');
    expect(rally.length).toBeGreaterThan(0);
    for (const entry of rally) expect(incumbentCommandActor(entry.command)).toEqual(miningDefenseActor('building-p0-townHall-1400'));
    for (const entry of entries.filter(entry => entry.scriptId === 'v6General'))
      expect(incumbentCommandActor(entry.command)?.source).not.toBe('miningDefense');
  });

  it('keeps actual defense running under its imported lease and excludes an unrelated formal grant', () => {
    const original = rallyFrame(), ordinary = plan(original);
    const ids = ordinary.filter(entry => entry.scriptId === 'v6General')
      .flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : []);
    const hallId = 'building-v9_archer-townHall-1602';
    const imported = rallyFrame();
    imported.memory.strategyAllocation = { ...createStrategyAllocationMemory(imported.owner, imported.snapshot.tick),
      leases: Object.fromEntries(ids.map(id => [`unit:${id}`, lease(imported, id, hallId, true)])) };
    const continued = plan(imported).filter(entry => entry.scriptId === 'v6General');
    expect(continued).toEqual(ordinary.filter(entry => entry.scriptId === 'v6General'));
    const removed = rallyFrame();
    removed.memory.strategyAllocation = { ...createStrategyAllocationMemory(removed.owner, removed.snapshot.tick),
      leases: Object.fromEntries(ids.map(id => [`unit:${id}`, lease(removed, id, hallId, false)])) };
    const defense = plan(removed).filter(entry => ['mineDefense', 'miningRally', 'miningLeash', 'v6General'].includes(entry.scriptId!));
    expect(defense.flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : []).some(id => ids.includes(id))).toBe(false);
  });

  it('hands off only the requested members at that post and preserves the remaining rally anchor', () => {
    const frame = rallyFrame(); plan(frame);
    const hallId = 'building-v9_archer-townHall-1602', actor = miningDefenseActor(hallId);
    const members = Object.keys(frame.memory.unitClaims).filter(id => frame.memory.unitClaims[id]!.targetId === hallId);
    expect(members).toHaveLength(19);
    const state = structuredClone(frame.memory.miningDefense), [taken, newer] = members;
    frame.memory.unitClaims[newer!] = { ...frame.memory.unitClaims[newer!]!, targetId: 'another-post' };
    const result = handoffIncumbent(frame.snapshot, frame.owner, frame.memory, actor, [taken!, newer!], 'real-rally:transfer');
    expect(result?.disposition).toBe('shrink');
    expect(frame.memory.unitClaims[taken!]).toBeUndefined();
    expect(frame.memory.unitClaims[newer!]!.targetId).toBe('another-post');
    expect(frame.memory.miningDefense).toEqual(state);
    expect(members.slice(2).every(id => frame.memory.unitClaims[id]!.targetId === hallId)).toBe(true);
  });
});
