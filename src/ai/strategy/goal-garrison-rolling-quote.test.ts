import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { declareGoalGarrison } from './goal-garrison-action';
import { goalFact } from './goal-facts';
import { createGoalNavalCombatGrounding, type GoalNavalCombatGroundingPorts } from './goal-naval-combat-grounding';
import { withGoalPlannerInput } from './goal-planner-input';
import type { GoalCombatOption, GoalFact, GoalPlanningContext } from './goal-planner-types';

// Full original 59792793 observer members, not reconstructed scenes. These
// tests call the domain/fact source only, never planner, executor, SDK or sim.
const originals = [
  { variant: 'near', tick: 6840, sha: '4923d93a9f226523b16bc77f850276cc3f84426263ec055324f9538b5eaef83b' },
  { variant: 'far', tick: 8400, sha: 'd45847c55fc94cf455caa8bc5b281fc82306fba4ef8de775d5d417649441ad2f' },
] as const;
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
const ids = [1, 2, 3, 4].map(n => `scene-public-planner-frame-planner-footman-${n}`);
const at = { entityId: 'resource-1', landId: 'land:2', point: { x: 2976, y: 896 } } as const;
function options(context: GoalPlanningContext, effect: GoalFact) {
  const forbidden = vi.fn(() => { throw Error('A hold quote must not price a second march'); });
  const ports: GoalNavalCombatGroundingPorts = { arrival: forbidden, landRoute: forbidden,
    movementRisk: forbidden, readGroundPoint: forbidden, allowedUnitIds: ids,
    resolveCohort: refs => ({ state: 'met', factIds: [], candidates: refs.flatMap(reference => {
      const unit = reference.kind === 'existing' ? context.snapshot.units.find(u => u.id === reference.entityId) : undefined;
      return unit ? [{ reference, assessment: unit }] : [];
    }) }) };
  const result = createGoalNavalCombatGrounding(context, ports).combatOptions!(effect);
  expect(result.state).toBe('met');
  if (result.state !== 'met') throw Error(JSON.stringify(result));
  const full = result.candidates.find(option => option.cohort.length === 4)!;
  expect(full).toBeDefined(); expect(forbidden).not.toHaveBeenCalled();
  return full;
}
function fixture(row: typeof originals[number], run: (context: GoalPlanningContext) => void) {
  const raw = readFileSync(new URL(`./fixtures/goal-garrison-597-${row.variant}-t${row.tick}.json.gz`, import.meta.url));
  expect(createHash('sha256').update(raw).digest('hex')).toBe(row.sha);
  const frame: { snapshot: GameSnapshot; memoryBefore: AiPolicyMemory } = JSON.parse(gunzipSync(raw).toString());
  expect(frame.snapshot.tick).toBe(row.tick);
  const before = JSON.stringify(frame.snapshot);
  strict(() => withGoalPlannerInput({ snapshot: frame.snapshot, memory: frame.memoryBefore,
    owner: 'planner', version: 'v9_knight', precision: 'exact' }, input => {
    run(input.context);
    expect(input.work.receipt.used).toBe(0);
  }));
  expect(JSON.stringify(frame.snapshot)).toBe(before);
}
function safety(option: GoalCombatOption) {
  const result = option.preconditions.filter(fact => fact.predicate.kind === 'site-safe');
  expect(result).toHaveLength(1); return result[0]!;
}

describe('garrison quotation within the published observation horizon', () => {
  it.each(originals)('$variant keeps the full hold and lease while quoting only the current supported window', row => fixture(row, context => {
    const throughTick = 20000;
    // Variable form exercises the shared optional field without changing its
    // type in this domain-only commit; the central adapter owns that addition.
    const predicate = { kind: 'garrison-ready' as const, mineId: 'resource-1', at, throughTick };
    const effect = goalFact(predicate), ctx = { ...context, planThroughTick: 30000 };
    const option = options(ctx, effect), fact = safety(option);
    const quotedThrough = context.tick + context.situation.horizonTicks;
    expect(quotedThrough).toBeLessThan(throughTick);
    expect(fact.predicate).toMatchObject({ throughTick: quotedThrough });
    expect(ctx.readFact(fact)).toMatchObject({ state: 'met', reason: { code: 'observed-safety-window-clear' } });
    expect(option.cost).toMatchObject({ state: 'met', value: [] });
    expect(option.successProbability).toMatchObject({ state: 'met', value: 1 });
    expect(option.factIds).toContain(fact.id);
    expect(option.byTick).toBe(throughTick);
    expect(option.duration).toMatchObject({ state: 'met', value: throughTick - context.tick });
    if (fact.predicate.kind !== 'site-safe') throw Error('safety fixture');
    const unsupported = goalFact({ ...fact.predicate, throughTick });
    expect(ctx.readFact(unsupported)).toMatchObject({ state: 'pending', reason: { code: 'safety-window-support-pending' } });
    const action = declareGoalGarrison({ ...option, mineId: 'resource-1', at, throughTick }, ctx)!;
    expect(action.kind).toBe('hold-position');
    expect(action.duration).toEqual(option.duration);
    expect(action.executor.parameters.throughTick).toBe(throughTick);
    expect(action.demands).toHaveLength(4);
    expect(action.demands.every(demand => demand.from === 'start' && demand.until === 'finish')).toBe(true);
    expect(action.effects.some(effect => effect.fact.predicate.kind === 'route-controlled'
      && effect.fact.predicate.throughTick === throughTick)).toBe(true);
    expect(action.preconditions).toContainEqual(fact);
    expect(action.preconditions).not.toContainEqual(unsupported);
  }));

  it.each(originals)('$variant keeps short obligations and the existing plan horizon intact', row => fixture(row, context => {
    const throughTick = context.tick + 600;
    const predicate = { kind: 'garrison-ready' as const, mineId: 'resource-1', at, throughTick };
    const short = options({ ...context, planThroughTick: 30000 }, goalFact(predicate));
    expect(safety(short).predicate).toMatchObject({ throughTick });
    expect(short.byTick).toBe(throughTick);
    expect(short.duration).toMatchObject({ state: 'met', value: 600 });
    const compatible = options({ ...context, planThroughTick: 20000 }, goalFact({ kind: 'garrison-ready', mineId: 'resource-1', at }));
    expect(compatible.byTick).toBe(20000);
    expect(compatible.duration).toMatchObject({ state: 'met', value: 20000 - context.tick });
  }));

  it.each(originals)('$variant performs no exact work in coarse discovery and retains the safety dependency', row => fixture(row, context => {
    const readFact = vi.fn(() => { throw Error('coarse garrison read an exact fact'); });
    const effect = goalFact({ kind: 'garrison-ready', mineId: 'resource-1', at });
    const option = options({ ...context, precision: 'coarse', readFact, planThroughTick: 20000 }, effect);
    const fact = safety(option);
    expect(fact.predicate).toMatchObject({ throughTick: context.tick + context.situation.horizonTicks });
    expect(option.byTick).toBe(20000);
    expect(option.duration).toMatchObject({ state: 'met', value: 20000 - context.tick });
    expect(option.factIds).toContain(fact.id);
    expect(readFact).not.toHaveBeenCalled();
  }));

  it.each(['pending', 'unmet'] as const)('preserves a %s current window instead of inventing a protection quote', state => fixture(originals[0], context => {
    const effect = goalFact({ kind: 'garrison-ready', mineId: 'resource-1', at });
    const readFact: GoalPlanningContext['readFact'] = fact => {
      const observed = context.readFact(fact);
      if (fact.predicate.kind !== 'site-safe') return observed;
      // Port-contract negative cases, separate from the unchanged original
      // quiet snapshots above. Neither absence nor an observed opponent is a
      // priced long-window guarantee.
      return state === 'pending' ? { ...observed, state, requestId: 'current-window-pending', requestedTick: context.tick,
        reason: { code: 'current-window-unpublished', factIds: [fact.id], values: {} } }
        : { ...observed, state, threats: { unitIds: ['observed-opponent'], campIds: [], requiredForce: 4 },
          reason: { code: 'observed-safety-threats-present', factIds: [fact.id], values: {} } };
    };
    const option = options({ ...context, planThroughTick: 20000, readFact }, effect);
    expect(option.cost).toMatchObject({ state: 'pending', reason: { code: 'garrison-post-protection-unpublished' } });
    expect(option.successProbability.state).toBe('pending');
    expect(safety(option).predicate).toMatchObject({ throughTick: context.tick + context.situation.horizonTicks });
    expect(option.duration).toMatchObject({ state: 'met', value: 20000 - context.tick });
  }));
});
