import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot, Unit } from '../../shared/types';
import { neutralCamps } from '../policy/v7/creep';
import { assessAllocatedForce } from './allocated-force';
import { arrivalWeightedForce } from './arrival-force';

describe('ETA-discounted allocated force', () => {
  it('keeps the real Ne four reinforcements out of ready camp force until they arrive', () => {
    const data = JSON.parse(gunzipSync(readFileSync(new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString());
    const { snapshot, owner } = data.frames['Ne-sapphireArchipelago-player-4-17991'] as { snapshot: GameSnapshot; owner: string };
    const mine = snapshot.resources.find(mine => mine.id === 'gold-satellite-2')!;
    const camp = neutralCamps(snapshot).sort((a, b) => Math.hypot(a.center.x - mine.x, a.center.y - mine.y)
      - Math.hypot(b.center.x - mine.x, b.center.y - mine.y))[0]!;
    const landed = snapshot.units.find(unit => unit.id === 'unit-player-4-emberRavager-3661')!;
    const incoming = snapshot.units.filter(unit => ['5287', '5642', '5789', '5909'].some(id => unit.id === `unit-player-4-emberRavager-${id}`));
    const assess = (group: readonly Unit[]) => assessAllocatedForce(owner, group, { metric: 'camp-force', camp }).force;
    const before = JSON.stringify(snapshot);
    // The controlled ETA variation tests accounting on the recorded cohort;
    // it is not a claim that the recorded voyage itself took exactly 900 ticks.
    const delayed = arrivalWeightedForce([landed], incoming.map(unit => ({ unit, etaTicks: 900 })), 900, assess);
    const ready = arrivalWeightedForce([landed, ...incoming], [], 900, assess);
    expect(delayed.onStationForce).toBeCloseTo(.9461, 3);
    expect(delayed.totalForce).toBeCloseTo(4.7307, 3);
    expect(delayed.effectiveForce).toBeCloseTo(delayed.onStationForce + (delayed.totalForce - delayed.onStationForce) / 2);
    expect(delayed.effectiveForce).toBeLessThan(assessAllocatedForce(owner, incoming, { metric: 'camp-force', camp }).requiredForce);
    expect(ready.effectiveForce).toBe(ready.totalForce);
    expect(ready.discountedEnRouteForce).toBe(0);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('is order invariant, evaluates cohort interactions, and does not double count a passenger', () => {
    const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
    const assess = (group: readonly { id: string }[]) => group.length * group.length;
    const rows = [{ unit: b, etaTicks: 10 }, { unit: c, etaTicks: 20 }];
    const result = arrivalWeightedForce([a], rows, 10, assess);
    expect(result.effectiveForce).toBeCloseTo(1 + (4 - 1) / 2 + (9 - 4) / 3);
    expect(arrivalWeightedForce([a], [...rows].reverse(), 10, assess)).toEqual(result);
    expect(arrivalWeightedForce([a], JSON.parse(JSON.stringify(rows)), 10, assess)).toEqual(result);
    expect(() => arrivalWeightedForce([a], [{ unit: a, etaTicks: 10 }], 10, assess)).toThrow(/twice/);
    expect(() => arrivalWeightedForce([], [{ unit: b, etaTicks: NaN }], 10, assess)).toThrow(/ETA/);
    expect(() => arrivalWeightedForce([a], rows, 0, assess)).toThrow(/window/);
  });
});
