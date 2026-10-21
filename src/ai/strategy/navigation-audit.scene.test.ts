import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { withNavigationAudit, type NavigationAuditEvent } from '../../shared/navigation-audit';
import { walkDestination } from '../../shared/terrain';
import { withNavigationPhase } from '../../shared/navigation-audit';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

type Frame = { name: string; snapshot: GameSnapshot; owner: string; version: BootstrapAiVersion;
  memory: AiPolicyMemory | null; teams?: Record<string, string> };
const frames: { inputSha256: string; frame: Frame }[] = JSON.parse(gunzipSync(readFileSync(
  new URL('./fixtures/navigation-audit-646-cold.json.gz', import.meta.url))).toString());
const contract: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(
  new URL('../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;

function guard(event: NavigationAuditEvent) {
  if (event.phase === 'strategy-planning' && !event.authorization)
    throw new Error(`Unmetered native planning: ${event.operation}`);
}
const comparisonReceipts: unknown[] = [];
afterAll(() => {
  const path = process.env.NAVIGATION_AUDIT_RECEIPT;
  if (path) writeFileSync(path, JSON.stringify(comparisonReceipts, null, 2));
});

describe('strategy observation does not rerun incumbent recovery selectors', () => {
  it.each(frames.map(value => value.frame).filter(frame => frame.snapshot.tick > 0).slice(0, 5))('$name', source => {
    const measure = (control: boolean) => {
      const frame = structuredClone(source), events: (NavigationAuditEvent & { selector: string | null })[] = [];
      const previousLimit = Error.stackTraceLimit; Error.stackTraceLimit = 60;
      try {
        withNavigationAudit(event => {
          const stack = new Error().stack ?? '';
          const selector = stack.includes('/front-recovery.ts') ? 'postRecoveryAssignments'
            : stack.includes('/mobile-care.ts') ? 'mobileCare' : null;
          events.push({ ...event, selector });
        }, () => planAiOwnerCommandEntries(frame.snapshot,
          { playerId: frame.owner, version: frame.version, memory: frame.memory ?? createAiPolicyMemory() },
          { strategyControl: control, ...(frame.teams ? { teams: frame.teams } : {}) }));
      } finally { Error.stackTraceLimit = previousLimit; }
      const counts = (items: typeof events) => Object.fromEntries([...new Set(items.map(event => `${event.selector}/${event.operation}`))]
        .sort().map(key => [key, items.filter(event => `${event.selector}/${event.operation}` === key).length]));
      return { nativeCounts: counts(events), recoveryCounts: counts(events.filter(event => event.selector)),
        planningRecovery: events.filter(event => event.selector && event.phase === 'strategy-planning') };
    };
    const off = measure(false), on = measure(true);
    comparisonReceipts.push({ name: source.name, off, on });
    expect(on.planningRecovery).toEqual([]);
    expect(on.recoveryCounts).toEqual(off.recoveryCounts);
  }, 60000);
});

it('rejects an unmetered native entry in diagnostic planning, while ordinary native calls keep their behavior', () => {
  const frame = structuredClone(frames[0]!.frame), from = frame.snapshot.units[0]!, goal = { x: from.x + 32, y: from.y };
  expect(() => withNavigationAudit(guard, () => withNavigationPhase('strategy-planning',
    () => walkDestination(frame.snapshot.map, from, goal)))).toThrow('Unmetered native planning: walkDestination');
  expect(() => walkDestination(frame.snapshot.map, from, goal)).not.toThrow();
});

describe('all native planning entries use the shared fact boundary in real cold frames', () => {
  const samples = [...frames.map(value => value.frame), { ...contract['Ne-sapphireArchipelago-player-4-17991']!,
    name: 'Ne-sapphireArchipelago-player-4-17991', version: 'v9_summoner' as const }];
  it.each(samples)('$name', source => {
    const frame = structuredClone(source), world = JSON.stringify(frame.snapshot), events: NavigationAuditEvent[] = [];
    // Original first-think recordings contain null. Initialize through the
    // public planner's ordinary factory rather than altering the raw input.
    const memory = frame.memory ?? createAiPolicyMemory();
    const entries = withNavigationAudit(event => { events.push(event); guard(event); }, () => planAiOwnerCommandEntries(frame.snapshot,
      { playerId: frame.owner, version: frame.version, memory },
      { strategyControl: true, ...(frame.teams ? { teams: frame.teams } : {}) }));
    expect(entries).toBeDefined();
    expect(memory.strategy!.observation.factWork!.used).toBeLessThanOrEqual(6144);
    if (memory.strategy!.observation.factWork!.used > 0)
      expect(events.some(event => event.phase === 'strategy-planning' && event.authorization?.kind === 'fact-work')).toBe(true);
    expect(events.filter(event => event.phase === 'strategy-planning' && !event.authorization)).toEqual([]);
    // Old producer routing is visible as its own phase, never relabelled as
    // allocator work or charged against a fictional formal allowance.
    expect(events.filter(event => event.phase === 'incumbent').every(event => !event.authorization)).toBe(true);
    expect(JSON.stringify(frame.snapshot)).toBe(world);
  }, 60000);
});
