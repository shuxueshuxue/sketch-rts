import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { declareGoalDestroyTarget, declareGoalEngageUnits, declareGoalHoldPosition, goalLandActionProvider, type GoalLandCombatGrounding } from './goal-land-actions';
import { goalFact } from './goal-facts';
import { withGoalSafetyPreconditionWindows } from './goal-safety-preconditions';
import type { GoalEntityReference, GoalPlanningContext } from './goal-planner-types';
import type { Situation, Target } from './types';

function scene() {
  const snapshot = snapshotGame(sketchScene('atomic-land-action-bindings').map('bareDuel').replaceDefaults()
    .player('us', { team: 'blue' }).player('ally', { team: 'blue' }).player('foe', { team: 'red' })
    .townHall('us', 300, 300).townHall('ally', 1800, 600, { id: 'allied-hall' })
    .townHall('foe', 2400, 600, { id: 'enemy-hall' }).unit('us', 'footman', 800, 600, { id: 'weak' })
    .unit('us', 'horseArcher', 300, 900, { id: 'counter' }).unit('foe', 'horseArcher', 950, 600, { id: 'harasser' })
    .unit('neutral', 'ogreWarrior', 1500, 1500, { id: 'neutral-guard' }).build().createGame());
  const situation: Situation = { tick: snapshot.tick, owner: 'us', horizonTicks: 2400, lands: [], seas: [], assets: [], units: [], opportunities: [],
    economy: { cashGold: snapshot.players.us!.gold, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] }, limitations: [] };
  const context: GoalPlanningContext = { snapshot, situation, owner: 'us', tick: snapshot.tick, version: 'v9_summoner',
    readFact: () => { throw Error('A declaration cannot rerun the fact/battle source'); } };
  return context;
}
const ref = (entityId: string): GoalEntityReference => ({ kind: 'existing', entityId });
const target: Target = { entityId: 'enemy-hall', landId: 'land:1', point: { x: 2400, y: 600 } };
function grounding(): GoalLandCombatGrounding {
  // Fixed typed assessment ports test declaration binding only, not combat
  // prediction or a public puzzle. No substitute world fact table is used.
  return { target, cohort: [ref('weak')], requiredForce: 1, byTick: 500,
    duration: { state: 'met', value: 500, factIds: ['shared-battle-duration'] },
    cost: { state: 'met', value: [{ code: 'permanent-casualties', gold: 10, factIds: ['shared-battle-casualties'] }], factIds: ['shared-battle-casualties'] },
    successProbability: { state: 'met', value: .9, factIds: ['shared-battle-probability'] } };
}

describe('atomic land action declarations', () => {
  it('destroys only an actual hostile target and gives expansion no bundled action', () => {
    const context = scene(), before = JSON.stringify(context.snapshot), input = grounding();
    const action = declareGoalDestroyTarget(input, context)!;
    expect(action.kind).toBe('destroy-target');
    expect(action.effects.map(effect => effect.fact.predicate)).toEqual([{ kind: 'enemy-site-destroyed', site: target }]);
    expect(action.preconditions.every(fact => fact.predicate.kind !== 'production' && fact.predicate.kind !== 'gold')).toBe(true);
    expect(declareGoalDestroyTarget({ ...input, target: { ...target, entityId: 'allied-hall' } }, context)).toBeNull();
    expect(declareGoalDestroyTarget({ ...input, target: { ...target, entityId: 'neutral-guard' } }, context)).toBeNull();
    expect(JSON.stringify(context.snapshot)).toBe(before);
  });

  it('binds counter capability to the granted cohort instead of another counter in the global pool', () => {
    const context = scene(), action = declareGoalEngageUnits({ ...grounding(), throughTick: 1000 }, context)!;
    const capability = action.preconditions.find(fact => fact.predicate.kind === 'interception-capability')!;
    expect(capability.predicate).toMatchObject({ cohort: [ref('weak')] });
    expect(JSON.stringify(capability)).not.toContain('counter');
    const selectedCounter = declareGoalEngageUnits({ ...grounding(), cohort: [ref('counter')], throughTick: 1000 }, context)!;
    expect(selectedCounter.id).not.toBe(action.id);
    expect(selectedCounter.preconditions.find(fact => fact.predicate.kind === 'force-at')!.predicate).toMatchObject({ cohort: [ref('counter')] });
  });

  it('holds the selected units for the control window and rejects a zero-time future promise', () => {
    const context = scene(), input = { ...grounding(), throughTick: 500 };
    const action = declareGoalHoldPosition(input, context)!;
    expect(action.effects[0]!.fact.predicate).toEqual({ kind: 'route-controlled', at: target, throughTick: 500 });
    expect(action.effects[0]!.at).toBe('start');
    expect(action.preconditions.find(fact => fact.predicate.kind === 'force-at')!.predicate).toMatchObject({ at: target, cohort: [ref('weak')] });
    expect(action.demands).toEqual([{ resource: { kind: 'entity-control', entity: ref('weak') }, quantity: 1, from: 'start', until: 'finish' }]);
    expect(declareGoalHoldPosition({ ...input, duration: { state: 'met', value: 0, factIds: [] } }, context)).toBeNull();
    expect(declareGoalHoldPosition({ ...input, post: { ...target, point: { x: 100, y: 100 } } }, context)).toBeNull();
  });

  it('bounds attack admission safety by finish while preserving holding obligations and world effects', () => {
    const context = scene(), safety = [goalFact({ kind: 'site-safe', site: target, throughTick: 5000 }),
      goalFact({ kind: 'shore-safe', landId: 'land:1', landing: target, throughTick: 5000 }),
      goalFact({ kind: 'assets-safe', unitIds: ['weak'], at: target, throughTick: 5000 })];
    const input = { ...grounding(), preconditions: safety };
    for (const action of [declareGoalDestroyTarget(input, context)!,
      declareGoalEngageUnits({ ...input, throughTick: 1000 }, context)!]) {
      for (const proof of action.preconditions.filter(fact => 'throughTick' in fact.predicate
        && fact.predicate.kind !== 'interception-capability')) {
        expect(proof.predicate).toMatchObject({ throughTick: context.tick + 500 });
        expect(action.preconditionWindows).toContainEqual({ factId: proof.id, through: 'finish' });
      }
      expect(action.demands.every(demand => demand.until === 'finish')).toBe(true);
    }
    const hold = declareGoalHoldPosition({ ...input, throughTick: 500 }, context)!;
    expect(safety.every(fact => hold.preconditions.some(proof => proof.id === goalFact({ ...fact.predicate, throughTick: 500 } as typeof fact.predicate).id))).toBe(true);
    expect(hold.preconditionWindows).toBeUndefined();
    expect(hold.effects[0]!.fact.predicate).toMatchObject({ throughTick: 500 });
  });

  it.each(['hold-position', 'defend'] as const)('uses rolling safety prerequisites for %s without changing its persistent effect or lease', kind => {
    const context = scene(), throughTick = context.tick + 12000;
    const safety = [goalFact({ kind: 'site-safe', site: target, throughTick }),
      goalFact({ kind: 'shore-safe', landId: 'land:1', landing: target, throughTick }),
      goalFact({ kind: 'assets-safe', unitIds: ['weak'], at: target, throughTick })];
    const hold = declareGoalHoldPosition({ ...grounding(), byTick: throughTick, throughTick,
      duration: { state: 'met', value: 12000, factIds: [] } }, context)!;
    expect(hold.executor.parameters.protectionWindowTicks).toBe(2400);
    const original = { ...hold, kind, preconditions: [...hold.preconditions, ...safety],
      // Same safety fact as an effect is intentionally retained at the full
      // obligation; mapping admission IDs must not change world promises.
      effects: [...hold.effects, { fact: safety[0]!, operation: 'establish' as const, at: 'start' as const }],
      preconditionWindows: safety.map(fact => ({ factId: fact.id, through: 'finish' as const })),
      cost: { state: 'met' as const, value: [{ code: 'quoted-current-loss', gold: 11, factIds: safety.map(fact => fact.id) }], factIds: safety.map(fact => fact.id) } };
    const action = withGoalSafetyPreconditionWindows(original, context.tick, context.situation.horizonTicks);
    const current = safety.map(fact => goalFact({ ...fact.predicate, throughTick: context.tick + 2400 } as typeof fact.predicate));
    expect(action.preconditions).toEqual(expect.arrayContaining(current));
    expect(action.preconditions.some(fact => safety.some(full => full.id === fact.id))).toBe(false);
    expect(action.cost).toMatchObject({ factIds: current.map(fact => fact.id), value: [{ gold: 11, factIds: current.map(fact => fact.id) }] });
    expect(action.preconditionWindows).toBeUndefined();
    expect(action.effects).toEqual(original.effects);
    expect(action.executor).toEqual(original.executor);
    expect(action.duration).toEqual(original.duration);
    expect(action.demands).toEqual(original.demands);
    expect(action.demands.every(demand => demand.until === 'finish')).toBe(true);
    expect(action.executor.parameters.throughTick).toBe(throughTick);
    expect(withGoalSafetyPreconditionWindows(action, context.tick, 2400)).toEqual(action);
  });

  it('retains pending assessments and symbolic future members without inventing world identities', () => {
    const context = scene(), future = { kind: 'output', actionId: 'training-action', output: 'unit-0' } as const;
    const input = { ...grounding(), cohort: [future], duration: { state: 'pending', requestIds: ['battle-request'],
      reason: { code: 'shared-battle-pending', factIds: [], values: {} } } as const };
    const action = declareGoalDestroyTarget(input, context)!;
    expect(action.duration.state).toBe('pending');
    expect(action.demands[0]!.resource).toEqual({ kind: 'entity-control', entity: future });
    expect(action.executor.parameters.cohort).toEqual([future]);
    expect(context.snapshot.units.some(unit => unit.id === future.output)).toBe(false);
    expect(declareGoalDestroyTarget({ ...grounding(), cohort: [ref('harasser')] }, context)).toBeNull();
    expect(declareGoalDestroyTarget({ ...grounding(), cohort: [ref('missing')] }, context)).toBeNull();
  });

  it('is stable across order, duplicate members and JSON forks; changing the selected group changes the identity', () => {
    const context = scene(), input = { ...grounding(), cohort: [ref('counter'), ref('weak')] };
    const first = declareGoalDestroyTarget(input, context)!;
    const second = declareGoalDestroyTarget({ ...input, cohort: [ref('weak'), ref('counter'), ref('weak')] }, context)!;
    expect(second).toEqual(first);
    expect(declareGoalDestroyTarget(JSON.parse(JSON.stringify(input)), { ...context, snapshot: JSON.parse(JSON.stringify(context.snapshot)) })).toEqual(first);
    expect(declareGoalDestroyTarget(grounding(), context)!.id).not.toBe(first.id);
  });

  it('enumerates only shared combat candidates and retains bound capability and pending time', () => {
    const base = scene(), future = { kind: 'binding', name: 'future-counter' } as const;
    const weak = { ...grounding(), id: 'weak', preconditions: [], factIds: ['shared-weak'] };
    const counter = { ...weak, id: 'future', cohort: [future], duration: { state: 'pending' as const,
      requestIds: ['future-route'], reason: { code: 'future-route-pending', factIds: ['future-route'], values: {} } } };
    const context: GoalPlanningContext = { ...base, grounding: {
      buildSites: () => { throw Error('Combat selected a construction recipe'); },
      productionOptions: () => { throw Error('Combat selected a training recipe'); },
      transportOptions: () => { throw Error('Combat ran transport grounding'); },
      combatOptions: () => ({ state: 'met', candidates: [weak, counter], factIds: ['shared-options'] }),
    } };
    const effect = goalFact({ kind: 'harassment-ended', site: target, throughTick: 1000 });
    const actions = goalLandActionProvider.actionsFor(effect, context);
    expect(actions).toHaveLength(2); expect(actions.every(action => action.kind === 'engage-units')).toBe(true);
    expect(actions.some(action => action.duration.state === 'pending')).toBe(true);
    for (const action of actions) expect(action.preconditions.find(fact => fact.predicate.kind === 'interception-capability')!.predicate)
      .toMatchObject({ cohort: action.executor.parameters.cohort });
    expect(goalLandActionProvider.actionsFor(effect, { ...context, grounding: { ...context.grounding!,
      combatOptions: () => ({ state: 'pending', requestIds: ['assessment'], reason: { code: 'assessment-pending', factIds: ['assessment'], values: {} } }) } })).toEqual([]);
    expect(goalLandActionProvider.actionsFor(goalFact({ kind: 'enemy-site-destroyed', site: { ...target, entityId: 'allied-hall' } }), context)).toEqual([]);
  });
});
