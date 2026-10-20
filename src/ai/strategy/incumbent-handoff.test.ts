import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { landExpansionActor } from './incumbent-actors';
import { handoffIncumbent } from './incumbent-handoff';

function sapphire() {
  return JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString())
    .frames['Ne-sapphireArchipelago-player-4-17991'] as { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory };
}
describe('incumbent handoff in the real sapphire assemble reservation', () => {
  it('releases all four reserved claims even though no combat group has formed', () => {
    const { snapshot, owner, memory } = sapphire(), task = memory.landExpansion!;
    const units = [5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`);
    expect(task.stage).toBe('assemble');
    expect(task.combat).toEqual({});
    for (const id of units) expect(memory.unitClaims[id]?.targetId).toBe(task.mineId);
    const result = handoffIncumbent(snapshot, owner, memory, landExpansionActor(task), units, 'preemption:test');
    expect(result?.disposition).toBe('pause');
    expect(result?.reason.reason).toBe('higher-priority-preemption');
    for (const id of units) expect(memory.unitClaims[id]).toBeUndefined();
    expect(task.paused).toBe(true);
    expect(task.reason).toBe('higher-priority-preemption');
    expect(snapshot.units.filter(unit => units.includes(unit.id)).every(unit => unit.order.type === 'idle')).toBe(true);
  });

  it('preserves a newer local order claim while releasing only its old expansion membership', () => {
    const { snapshot, owner, memory } = sapphire(), task = memory.landExpansion!, id = 'unit-player-4-emberRavager-5287';
    const prior = memory.unitClaims[id]!;
    memory.unitClaims[id] = { ...prior, kind: 'mineRally', targetId: 'another-hall', expansionMineId: task.mineId };
    const result = handoffIncumbent(snapshot, owner, memory, landExpansionActor(task), [id], 'preemption:partial');
    expect(result?.disposition).toBe('shrink');
    expect(memory.unitClaims[id]?.kind).toBe('mineRally');
    expect(memory.unitClaims[id]?.targetId).toBe('another-hall');
    expect(memory.unitClaims[id]?.expansionMineId).toBeUndefined();
  });
});
