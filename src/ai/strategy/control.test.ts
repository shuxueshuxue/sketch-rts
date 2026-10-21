import { describe, expect, it } from 'vitest';
import { assertStrategyAllocationBounds, createStrategyAllocationMemory, STRATEGY_ALLOCATION_LIMITS, strategyLeaseAllows } from './control';
import type { ResourceLease, StrategyAllocationMemory } from './allocation-types';

const action = { actionId: 'defend/hall/local', generation: 1 };
const lease: ResourceLease = { id: 'lease/guard', resourceKey: 'unit:guard', objectiveId: 'defend/hall', methodId: 'defend/hall/local',
  action, sinceTick: 15, minimumStayUntilTick: 315, origin: 'allocator', incumbentTask: null };
const base = () => createStrategyAllocationMemory('us', 15);
const memory = (entry = lease) => ({ strategyAllocation: { ...base(), leases: { 'unit:guard': entry } } });

describe('formal resource authority', () => {
  it('leaves unleased resources available and rejects every other action on the same physical unit', () => {
    expect(strategyLeaseAllows({}, 'guard')).toBe(true);
    expect(strategyLeaseAllows(memory(), 'free')).toBe(true);
    expect(strategyLeaseAllows(memory(), 'guard')).toBe(false);
    expect(strategyLeaseAllows(memory(), 'guard', { source: 'naval' })).toBe(false);
    expect(strategyLeaseAllows(memory(), 'guard', { action })).toBe(true);
    expect(strategyLeaseAllows(memory(), 'guard', { action: { ...action, generation: 2 } })).toBe(false);
    expect(strategyLeaseAllows(memory(), 'guard', { action: { ...action, actionId: 'conquer/island' } })).toBe(false);
  });

  it('keeps imported bookkeeping transparent until a formal takeover exists', () => {
    const imported = memory({ ...lease, origin: 'imported-task', incumbentTask: { source: 'mineGuard', taskId: 'mine-a' } });
    expect(strategyLeaseAllows(imported, 'guard')).toBe(true);
    expect(strategyLeaseAllows(imported, 'guard', { source: 'naval' })).toBe(true);
    expect(strategyLeaseAllows(imported, 'guard', { source: 'mineGuard', taskId: 'mine-b' })).toBe(true);
    expect(strategyLeaseAllows(imported, 'guard', { source: 'mineGuard', taskId: 'mine-a' })).toBe(true);
    expect(strategyLeaseAllows(imported, 'guard', { source: 'mineGuard' })).toBe(true);
    expect(strategyLeaseAllows(JSON.parse(JSON.stringify(imported)), 'guard', { source: 'mineGuard' })).toBe(true);
    expect(strategyLeaseAllows(imported, 'guard', { action: { ...action, generation: 2 } })).toBe(false);
    const withFormal = { strategyAllocation: { ...imported.strategyAllocation,
      leases: { ...imported.strategyAllocation.leases, 'unit:other': { ...lease, resourceKey: 'unit:other' as const } } } };
    expect(strategyLeaseAllows(withFormal, 'guard', { source: 'naval' })).toBe(false);
    expect(strategyLeaseAllows(withFormal, 'guard', { source: 'mineGuard', taskId: 'mine-a' })).toBe(true);
  });
});

describe('formal memory bounds', () => {
  it('measures the UTF-8 save representation and never silently coerces nonfinite data', () => {
    const value = base();
    expect(assertStrategyAllocationBounds(value)).toBe(new TextEncoder().encode(JSON.stringify(value)).length);
    const fork = JSON.parse(JSON.stringify(value));
    expect(assertStrategyAllocationBounds(fork)).toBe(assertStrategyAllocationBounds(value));
    expect(() => assertStrategyAllocationBounds({ ...value, evaluatedTick: Infinity })).toThrow(/Nonfinite/);
    expect(() => assertStrategyAllocationBounds({ ...value, evaluatedTick: undefined } as unknown as StrategyAllocationMemory)).toThrow(/Non-JSON/);
  });

  it('throws on record and byte overflow instead of deleting a live commitment', () => {
    const value = { ...base(), events: Array(STRATEGY_ALLOCATION_LIMITS.events + 1).fill({}) } as StrategyAllocationMemory;
    expect(() => assertStrategyAllocationBounds(value)).toThrow(/events limit/);
    expect(value.events).toHaveLength(STRATEGY_ALLOCATION_LIMITS.events + 1);
    const large = { ...base(), owner: '岛'.repeat(STRATEGY_ALLOCATION_LIMITS.bytes / 2) };
    expect(() => assertStrategyAllocationBounds(large)).toThrow(/byte limit/);
    expect(large.owner).toHaveLength(STRATEGY_ALLOCATION_LIMITS.bytes / 2);
  });

  it('rejects cyclic, executable and class state before it can enter a save', () => {
    const cycle = base() as unknown as Record<string, unknown>; cycle.self = cycle;
    expect(() => assertStrategyAllocationBounds(cycle as StrategyAllocationMemory)).toThrow(/Cyclic/);
    expect(() => assertStrategyAllocationBounds({ ...base(), callback: () => undefined } as StrategyAllocationMemory)).toThrow(/Non-JSON/);
    expect(() => assertStrategyAllocationBounds({ ...base(), cache: new Map() } as StrategyAllocationMemory)).toThrow(/Non-JSON/);
  });
});
