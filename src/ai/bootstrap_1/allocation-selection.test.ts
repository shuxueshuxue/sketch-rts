import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createStrategyAllocationMemory } from '../strategy/control';
import { bootstrapPolicyContext } from './policy';
import { expansionMissionUnitIds } from './expansion-mission';

type Frame = { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
const borrowed = [5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`);

describe('incumbent selection under formal leases', () => {
  it('does not retake the real sapphire four-unit cohort after the allocator lends it to the island', () => {
    const frame = structuredClone(frames['Ne-sapphireArchipelago-player-4-17991']!);
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    expect(borrowed.every(id => expansionMissionUnitIds(frame.memory).includes(id))).toBe(true);
    const action = { actionId: 'ConquerIsland:player-4:gold-satellite-2/deliver', generation: 1 };
    frame.memory.strategyAllocation = { ...createStrategyAllocationMemory(frame.owner, frame.snapshot.tick),
      leases: Object.fromEntries(borrowed.map(id => [`unit:${id}`, { id: `lease:${id}`, resourceKey: `unit:${id}`,
        objectiveId: 'ConquerIsland:player-4:gold-satellite-2', methodId: 'island-delivery', action,
        sinceTick: frame.snapshot.tick, minimumStayUntilTick: frame.snapshot.tick, origin: 'allocator', incumbentTask: null }])) };
    bootstrapPolicyContext(frame.snapshot, frame.owner, 'v9_knight', { memory: frame.memory });
    expect(expansionMissionUnitIds(frame.memory).filter(id => borrowed.includes(id))).toEqual([]);
    expect(borrowed.map(id => frame.memory.strategyAllocation!.leases[`unit:${id}`]!.action)).toEqual(borrowed.map(() => action));
  });
});
