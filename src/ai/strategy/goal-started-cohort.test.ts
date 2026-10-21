import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot, Unit } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { effectiveCombatRating } from '../policy/v6/strength';
import { assessAllocatedForce } from './allocated-force';
import { createGoalCoarseTransport } from './goal-coarse-transport';
import type { GoalExecutableIntent } from './goal-execution-types';
import { FactWorkQueue } from './fact-work';
import { goalFact, resolveGoalCamp } from './goal-facts';
import { createGoalGeometryReader } from './goal-geometry-source';
import { createGoalNavalCombatGrounding, type GoalNavalCombatGroundingPorts } from './goal-naval-combat-grounding';
import { goalNavalActionProvider } from './goal-naval-provider';
import type { GoalEntityReference, GoalFactObservation, GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';
import { goalStartedCohortGroups } from './goal-started-cohort';
import { createGoalTransportCohorts } from './goal-transport-cohorts';
import { createGoalFactReader, createGoalWorldFactMemory } from './goal-world-facts';
import { landIdAt, seaIdAt, regionIndex } from './regions';
import { evaluateSituation } from './situation';
import type { Target } from './types';

type Record = { variant: string; owner: string; snapshot: GameSnapshot; campId: string; loadingPost: Target;
  originalForceAt: GoalFactObservation; started: { tick: number; token: { generation: number }; intent: GoalExecutableIntent;
    admissions: { status: string; command: { unitIds: string[] } }[];
    sdkCommands: { scriptId: string; command: { unitIds: string[] } }[] } };
const records: Record[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/goal-started-cohort-12ec.json.gz', import.meta.url))).toString());
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
const ids = (references: readonly GoalEntityReference[]) => references.map(ref => {
  if (ref.kind !== 'existing') throw Error('actual member required'); return ref.entityId;
}).sort();
function fixture(record: Record) {
  const snapshot = structuredClone(record.snapshot), regions = regionIndex(snapshot.map);
  const situation = evaluateSituation(snapshot, record.owner, createAiPolicyMemory());
  const refs = record.started.intent.parameters.cohort as readonly GoalEntityReference[];
  const work = new FactWorkQueue(snapshot.tick, 0);
  const forbidden = vi.fn(() => { throw Error('coarse selection requested private geometry'); });
  const resolveCohort: NonNullable<GoalGroundingReader['resolveCohort']> = refs => ({ state: 'met', factIds: [],
    candidates: refs.flatMap(reference => {
      const actor = reference.kind === 'existing' && snapshot.units.find(unit => unit.id === reference.entityId);
      return actor ? [{ reference, assessment: actor }] : [];
    }) });
  let context: GoalPlanningContext = { snapshot, owner: record.owner, situation, tick: snapshot.tick, version: 'v9_knight',
    precision: 'coarse', planThroughTick: snapshot.tick + 12000, readFact: forbidden };
  const world = createGoalFactReader({ ...context, memory: createGoalWorldFactMemory(record.owner), ports: {
    geometryRevision: 'original-12ec-world', reservedGold: 0,
    geometry: createGoalGeometryReader({ tick: snapshot.tick, work, memory: { version: 1, entries: [] } }),
    regionAt: (point, mover) => mover === 'land' ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point), landRoute: forbidden,
  } });
  const startedCohort = () => refs;
  const transportOptions = createGoalCoarseTransport(context, regions, resolveCohort);
  const cohortOptions = createGoalTransportCohorts(context, { transportOptions, startedCohort });
  const ports: GoalNavalCombatGroundingPorts = { arrival: forbidden, landRoute: forbidden, resolveCohort,
    readGroundPoint: forbidden, movementRisk: forbidden, startedCohort, cohortOptions };
  const naval = createGoalNavalCombatGrounding(context, ports);
  context = { ...context, grounding: { buildSites: forbidden, productionOptions: forbidden, transportOptions,
    resolveCohort, cohortOptions, ...naval } };
  return { snapshot, context, refs, world, work, forbidden, ports, naval, transportOptions, cohortOptions };
}

describe('actually started naval cohorts', () => {
  for (const record of records) it(`keeps the four receipt-backed footmen ready at the ${record.variant} loading post after three lancers appear`, () => {
    const f = fixture(record), before = JSON.stringify(f.snapshot), expected = ids(f.refs);
    expect(record.started.token.generation).toBe(2);
    expect(record.started.admissions).toHaveLength(4);
    expect(record.started.admissions.every(row => row.status === 'accepted')).toBe(true);
    expect(record.started.sdkCommands.every(row => row.scriptId === 'goal.assemble')).toBe(true);
    expect(record.started.sdkCommands.flatMap(row => row.command.unitIds).sort()).toEqual(expected);
    const effect = goalFact({ kind: 'camp-cleared', campId: record.campId });
    const { startedCohort: _started, ...uncommitted } = f.ports;
    const plain = createGoalNavalCombatGrounding(f.context, uncommitted);
    const broad = strict(() => plain.combatOptions!(effect));
    expect(broad.state).toBe('met');
    if (broad.state !== 'met') throw Error('native camp unavailable');
    expect(broad.candidates.some(option => option.cohort.length === 7)).toBe(true);
    const clear = strict(() => goalNavalActionProvider.actionsFor(effect, f.context));
    expect(clear.length).toBeGreaterThan(0);
    expect(clear.every(action => JSON.stringify(ids(action.executor.parameters.cohort as readonly GoalEntityReference[])) === JSON.stringify(expected))).toBe(true);
    const camp = resolveGoalCamp(f.snapshot, record.campId);
    if (camp.status !== 'present') throw Error('native camp missing');
    const group = f.snapshot.units.filter(unit => expected.includes(unit.id));
    expect(assessAllocatedForce(record.owner, group, { metric: 'camp-force', camp: camp.exposure.camp }).sufficient).toBe(true);
    const landings = strict(() => f.cohortOptions(effect));
    expect(landings.state).toBe('met');
    if (landings.state !== 'met') throw Error('native coarse contacts unavailable');
    expect(landings.candidates.every(option => JSON.stringify(ids(option.members.map(member => member.reference))) === JSON.stringify(expected))).toBe(true);
    const need = clear[0]!.preconditions.find(fact => fact.predicate.kind === 'force-available')!;
    const moves = strict(() => goalNavalActionProvider.actionsFor(need, f.context)).filter(action => action.kind === 'transport-force');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(action => JSON.stringify(ids(action.executor.parameters.cohort as readonly GoalEntityReference[])) === JSON.stringify(expected))).toBe(true);
    // The old seven-person observation remains false. A newly declared exact
    // four-person requirement can be met by the actual world, without marking
    // any absent lancer arrived or weakening the reader.
    expect(strict(() => f.world(record.originalForceAt.fact))).toMatchObject({ state: 'unmet', reason: { code: 'selected-cohort-not-at-location' } });
    const old = record.originalForceAt.fact.predicate;
    if (old.kind !== 'force-at') throw Error('original post missing');
    const at = goalFact({ ...old, cohort: f.refs, minimum: group.reduce((sum, unit) => sum + effectiveCombatRating(f.snapshot, unit), 0) });
    expect(strict(() => f.world(at))).toMatchObject({ state: 'met', entityIds: expected });
    for (const action of moves) {
      const post = action.preconditions.find(fact => fact.predicate.kind === 'force-at')!;
      expect(ids(post.predicate.kind === 'force-at' ? post.predicate.cohort! : [])).toEqual(expected);
      expect(strict(() => f.world(post)).state).toBe('met');
      expect(action.demands.filter(demand => demand.resource.kind === 'entity-control')).toHaveLength(5); // Four passengers and one hull.
    }
    strict(() => f.work.flush()); expect(f.work.receipt.used).toBe(0);
    expect(f.forbidden).not.toHaveBeenCalled(); expect(JSON.stringify(f.snapshot)).toBe(before);
  });

  it.each(['death', 'interruption'] as const)('keeps eligible survivors and fills only the deficit after %s', loss => {
    const f = fixture(records[0]!), all = f.snapshot.units.filter(unit => unit.owner === f.context.owner && unit.hp > 0
      && unit.kind !== 'worker' && unit.attackDamage > 0);
    const effect = goalFact({ kind: 'camp-cleared', campId: records[0]!.campId });
    const retained = ids(f.refs), missing = retained.slice(0, 2);
    const snapshot = loss === 'death' ? { ...f.snapshot,
      units: f.snapshot.units.map(unit => missing.includes(unit.id) ? { ...unit, hp: 0 } : unit) } : f.snapshot;
    const available = all.filter(unit => !missing.includes(unit.id));
    const selected = goalStartedCohortGroups({ ...f.context, snapshot }, effect, available, () => f.refs)!;
    expect(selected).toHaveLength(1); const group = selected[0]!;
    expect(retained.slice(2).every(id => group.some(unit => unit.id === id))).toBe(true);
    expect(group.filter(unit => !retained.includes(unit.id))).toHaveLength(1);
    const camp = resolveGoalCamp(f.snapshot, records[0]!.campId);
    if (camp.status !== 'present') throw Error('native camp missing');
    expect(assessAllocatedForce(f.context.owner, group, { metric: 'camp-force', camp: camp.exposure.camp }).sufficient).toBe(true);
    expect(goalStartedCohortGroups(f.context, effect, all.slice().reverse(), () => f.refs)![0]!.map(unit => unit.id)).toEqual(retained);
  });

  it('honors the actual exclusion pool without using newborns to enlarge an otherwise adequate group', () => {
    const f = fixture(records[0]!), interrupted = ids(f.refs)[0]!;
    const factory = createGoalNavalCombatGrounding(f.context, { ...f.ports, interruptedUnitIds: [interrupted] });
    const effect = goalFact({ kind: 'camp-cleared', campId: records[0]!.campId });
    const answer = strict(() => factory.combatOptions!(effect));
    expect(answer.state).toBe('met'); if (answer.state !== 'met') throw Error('native remaining camp quote unavailable');
    const expected = ids(f.refs).filter(id => id !== interrupted);
    expect(answer.candidates.every(option => JSON.stringify(ids(option.cohort)) === JSON.stringify(expected))).toBe(true);
  });

  it('anchors the landing proposal to its retained group rather than an earlier unselected pool member', () => {
    const f = fixture(records[0]!), retained = f.refs.slice(1), expected = ids(retained);
    const transportOptions = vi.fn(f.transportOptions);
    const read = createGoalTransportCohorts(f.context, { transportOptions, startedCohort: () => retained });
    const answer = strict(() => read(goalFact({ kind: 'camp-cleared', campId: records[0]!.campId })));
    expect(answer.state).toBe('met');
    const first = f.snapshot.units.find(unit => unit.id === expected[0])!;
    expect(transportOptions).toHaveBeenCalledWith(expect.objectContaining({ point: { x: first.x, y: first.y } }),
      expect.anything(), 0, { cohort: retained });
    if (answer.state !== 'met') throw Error('native coarse contact missing');
    expect(answer.candidates.every(option => JSON.stringify(ids(option.members.map(member => member.reference))) === JSON.stringify(expected))).toBe(true);
  });

  it('fills increased demand, leaves late committed reinforcements behind when the on-post group suffices, and respects exact cohorts', () => {
    const f = fixture(records[1]!), all = f.snapshot.units.filter(unit => unit.owner === f.context.owner && unit.hp > 0
      && unit.kind !== 'worker' && unit.attackDamage > 0);
    const original = all.filter(unit => ids(f.refs).includes(unit.id));
    const minimum = original.reduce((sum, unit) => sum + effectiveCombatRating(f.snapshot, unit), 0);
    const larger = goalFact({ kind: 'force-at', at: records[1]!.loadingPost, metric: 'combat-rating', minimum: minimum + .1,
      byTick: f.snapshot.tick + 12000 });
    const expanded = goalStartedCohortGroups(f.context, larger, all, () => f.refs)![0]!;
    expect(expanded).toHaveLength(5); expect(original.every(unit => expanded.includes(unit))).toBe(true);
    const committed = all.map(unit => ({ kind: 'existing' as const, entityId: unit.id }));
    const adequate = goalFact({ ...larger.predicate, kind: 'force-at', at: records[1]!.loadingPost,
      metric: 'combat-rating', minimum, byTick: f.snapshot.tick + 12000 });
    const departing = goalStartedCohortGroups(f.context, adequate, all, () => committed)![0]!;
    expect(departing.some(unit => unit.id === 'unit-planner-lancer-1029')).toBe(false);
    expect(departing.reduce((sum, unit) => sum + effectiveCombatRating(f.snapshot, unit), 0)).toBeGreaterThanOrEqual(minimum);
    const explicit = goalFact({ ...larger.predicate, kind: 'force-at', at: records[1]!.loadingPost,
      metric: 'combat-rating', minimum, byTick: f.snapshot.tick + 12000, cohort: committed });
    expect(goalStartedCohortGroups(f.context, explicit, all, () => f.refs)).toBeUndefined();
    expect(strict(() => f.world(explicit))).toMatchObject({ state: 'unmet', reason: { code: 'selected-cohort-not-at-location' } });
  });
});
