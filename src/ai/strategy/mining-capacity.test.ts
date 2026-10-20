import { describe, expect, it } from 'vitest';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { miningCapacity } from './mining-capacity';

describe('mine physical capacity', () => {
  it('preserves the native admission limit without promising staffed income', () => {
    const empty = miningCapacity([]), staffed = miningCapacity(['worker-b', 'worker-a', 'worker-b']);
    expect(empty.goldPerTickCap * empty.entryIntervalTicks).toBe(GOLD_MINE_RULES.goldPerTrip);
    expect(empty.gatherTicks).toBe(GOLD_MINE_RULES.gatherSeconds * SIM_TICKS_PER_SECOND);
    expect(empty.standardWorkers).toBe(GOLD_MINE_RULES.workstations);
    expect(staffed.staffedWorkerIds).toEqual(['worker-a', 'worker-b']);
    expect(staffed.goldPerTickCap).toBe(empty.goldPerTickCap);
    expect(empty.staffedWorkerIds).toEqual([]);
  });
});
