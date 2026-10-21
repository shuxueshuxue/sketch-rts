import { setBuildingBodies, withGoalDistanceFieldLease } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { shareShipProfile } from '../../shared/ship-geometry';
import type { BootstrapAiVersion, GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { reservedAllocationGold } from './allocation-ledger';
import { createArrivalQuery } from './arrivals';
import { createPlanningDistanceQuery } from './distance-fields';
import { decisionProjection } from './explanations';
import type { DecisionFacts } from './decision';
import { currentFactWork, FactWorkQueue, withFactWork } from './fact-work';
import { withStrategyFrame } from './frame-reuse';
import { createGoalEconomicGrounding } from './goal-economy-grounding';
import { goalEconomyActionProvider } from './goal-economy-provider';
import { goalFact, goalResourceKey, goalValueKey } from './goal-facts';
import { createGoalGeometryReader } from './goal-geometry-source';
import { goalLandActionProvider } from './goal-land-actions';
import { readGoalLandCapabilityFact } from './goal-land-facts';
import { goalNavalActionProvider } from './goal-naval-provider';
import { collectGoalRequests } from './goal-requests';
import { planGoals } from './goal-planner';
import type { GoalCandidates, GoalCohortMember, GoalFactObservation, GoalGroundingReader, GoalPlannerInput,
  GoalPlannerCache, GoalPlanningContext, GoalRequest, GoalResourceBalance, GoalSearchLimits } from './goal-planner-types';
import { groundGoalTransportOptions } from './goal-transport-grounding';
import { createGoalTransportFactPorts } from './goal-transport-physical-ports';
import { createGoalFactReader, createGoalWorldFactMemory, type GoalWorldFactMemory } from './goal-world-facts';
import { boundObservationMemory, observationHistory, observationMemory } from './observation-memory';
import { generateStrategyObjectives } from './plan';
import { pointRoute } from './point-routes';
import { landIdAt, regionIndex, seaIdAt } from './regions';
import { evaluateSituation } from './situation';
import type { Objective, SituationObservation } from './types';

export type GoalPlannerRuntimeMemory = {
  version: 1; owner: PlayerId; world: GoalWorldFactMemory; cache?: GoalPlannerCache;
};
export type GoalPlannerOwnerInput = Readonly<{
  snapshot: GameSnapshot; owner: PlayerId; version: BootstrapAiVersion; memory: AiPolicyMemory;
  /** Omit to consume the ordinary observer's Objective list. Explicit goals
   * are for callers that already have requests, never fabricated observations. */
  goals?: readonly GoalRequest[];
  objectives?: readonly DecisionFacts<Objective>[];
  work?: FactWorkQueue; limits?: GoalSearchLimits;
  observation?: SituationObservation;
  allowedUnitIds?: readonly string[]; interruptedUnitIds?: readonly string[];
}>;

export function planOwnerGoals(input: GoalPlannerOwnerInput) {
  return withGoalPlannerInput(input, planning => {
    const output = planGoals(planning);
    input.memory.goalPlanning!.cache = output.cache;
    return output;
  });
}

/** Native tooling and owner-think entry. The callback covers assembly AND
 * search in one terrain/query/work scope. It does not grant or issue commands. */
export function withGoalPlannerInput<T>(input: GoalPlannerOwnerInput, run: (input: GoalPlannerInput) => T): T {
  const { snapshot, owner, memory } = input;
  return withGoalDistanceFieldLease(snapshot.map, owner, snapshot.tick, () => withStrategyFrame(() => {
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const preparation = observationMemory(snapshot, owner, memory);
    const work = input.work ?? currentFactWork() ?? new FactWorkQueue(snapshot.tick, 6144, preparation.factWork);
    return withFactWork(work, () => {
      const regions = regionIndex(snapshot.map), distances = createPlanningDistanceQuery(snapshot, 1, 'land', preparation);
      const arrivals = createArrivalQuery(snapshot, owner, memory, distances, 1, regions, preparation, false);
      // This is the sole Situation evaluation. In an actual owner think the
      // caller supplies the ordinary planner's accepted healing observations;
      // an isolated cold frame has none, and never previews old selectors.
      const observed = decisionProjection(() => {
        const situation = evaluateSituation(snapshot, owner, memory, observationHistory(preparation),
          snapshot.teams, 1, input.observation ?? { healing: [] }, preparation, { regions, distances, arrivals });
        const objectives = input.objectives ?? (input.goals === undefined
          ? generateStrategyObjectives(situation, { snapshot, owner, memory, ...(snapshot.teams ? { teams: snapshot.teams } : {}) }, preparation.history?.objectives)
            .map(entry => entry.objective) : []);
        return { situation, objectives };
      }, false).facts;
      const { situation } = observed;
      let retained = memory.goalPlanning;
      if (!retained || retained.version !== 1 || retained.owner !== owner) {
        retained = { version: 1, owner, world: createGoalWorldFactMemory(owner) };
        memory.goalPlanning = retained;
      }
      const geometry = createGoalGeometryReader({ tick: snapshot.tick, work,
        memory: preparation.goalGeometry ??= { version: 1, entries: [] } });
      const geometryRevision = goalValueKey([preparation.terrain, preparation.landBodies,
        snapshot.buildings.map(building => [building.id, building.owner, building.kind, building.hp > 0, building.complete])]);
      const regionAt = (point: { x: number; y: number }, mover: 'land' | 'sea') => mover === 'land'
        ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point);
      const reservedGold = memory.strategyAllocation?.owner === owner ? reservedAllocationGold(memory.strategyAllocation) : 0;
      const context: GoalPlanningContext = { snapshot, owner, tick: snapshot.tick, version: input.version, situation,
        readFact: fact => read(fact) };
      const read = createGoalFactReader({ ...context, memory: retained.world,
        ...(input.allowedUnitIds === undefined ? {} : { allowedUnitIds: input.allowedUnitIds }),
        ...(input.interruptedUnitIds === undefined ? {} : { interruptedUnitIds: input.interruptedUnitIds }),
        ports: { geometry, geometryRevision, regionAt, reservedGold,
          landRoute: (from, goal) => {
            const published = distances.field(goal);
            if (!published) return { status: 'unknown', reasonCode: 'goal-land-route-pending' };
            const distance = published.field.cost(from), points = published.field.road(from, goal);
            return distance === undefined || !points ? { status: 'unreachable', reasonCode: 'goal-land-route-unreachable' }
              : { status: 'known', distance, points };
          },
          seaRoute: (predicate, actor) => {
            const fact = goalFact(predicate), ship = { ...actor, sailing: { ...actor.sailing!,
              heading: predicate.fromHeading ?? actor.sailing?.heading ?? 0 } };
            shareShipProfile(actor, ship);
            const future = actor.x !== predicate.from.point.x || actor.y !== predicate.from.point.y
              || predicate.fromHeading !== undefined && predicate.fromHeading !== actor.sailing?.heading;
            if (future) { delete ship.sailing.route; delete ship.sailing.planningJob; }
            const result = pointRoute(snapshot, preparation, ship, predicate.from.point, predicate.to.point, future);
            const revision = goalValueKey([fact.id, geometryRevision, result]);
            if (result.status === 'complete') {
              const points = [predicate.from.point, ...result.route.points];
              const distance = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0);
              return { fact, state: 'met', observedTick: snapshot.tick, revision, evidence: [], availableTick: snapshot.tick,
                reason: { code: 'native-sea-route-published', factIds: [fact.id], values: {} }, route: { distance, ticks: result.ticks, points } };
            }
            const common = { fact, observedTick: snapshot.tick, revision, evidence: [],
              reason: { code: result.reasonCode, factIds: [fact.id], values: {} } };
            return result.status === 'static-infeasible' ? { ...common, state: 'unmet' }
              : { ...common, state: 'pending', requestId: `point:${fact.id}`, requestedTick: snapshot.tick };
          },
          resolvers: [(fact, factsContext) => readGoalLandCapabilityFact(fact, factsContext, {
            regionAt: point => landIdAt(snapshot.map, point) ?? null,
          })],
        } });
      const economy = createGoalEconomicGrounding(context, { geometry, geometryRevision, regionAt });
      const resolveCohort: NonNullable<GoalGroundingReader['resolveCohort']> = references => {
        const members: GoalCohortMember[] = [];
        for (const reference of references) {
          if (reference.kind !== 'existing') return { state: 'pending', requestIds: [`output-shape:${goalValueKey(reference)}`],
            reason: { code: 'goal-output-assessment-binding-required', factIds: [], values: {} } };
          const assessment = snapshot.units.find(unit => unit.id === reference.entityId && unit.owner === owner && unit.hp > 0);
          if (!assessment) return { state: 'unmet', reason: { code: 'goal-cohort-member-unavailable', factIds: [reference.entityId], values: {} } };
          members.push({ reference, assessment });
        }
        return { state: 'met', candidates: members, factIds: members.map(member => member.assessment.id) };
      };
      const physical = createGoalTransportFactPorts({ snapshot, owner, tick: snapshot.tick, byTick: snapshot.tick + situation.horizonTicks,
        regions, geometry, geometryRevision, shoreGeometryRevision: preparation.terrain,
        readFact: read, resolveCohort, productionOptions: economy.productionOptions,
        readPointRoute: (ship, from, to, future) => {
          const pose = { ...ship, sailing: { ...ship.sailing!, heading: from.heading } };
          shareShipProfile(ship, pose);
          return { id: `point:${goalValueKey([ship.kind, from, to, future])}`, fact: pointRoute(snapshot, preparation, pose, from, to, future) };
        } });
      const transportOptions: GoalGroundingReader['transportOptions'] = (from, to, _mass, request) => {
        if (!request) return { state: 'pending', requestIds: ['transport-exact-cohort'],
          reason: { code: 'transport-exact-cohort-required', factIds: [], values: {} } };
        const members = resolveCohort(request.cohort);
        return groundGoalTransportOptions({ snapshot, owner, tick: snapshot.tick, byTick: snapshot.tick + situation.horizonTicks,
          from, to, request, members: members.state === 'met' ? { state: 'met', value: members.candidates, factIds: members.factIds } : members,
          ports: physical, readFact: read });
      };
      const grounded: GoalPlanningContext = { ...context, grounding: { ...economy, resolveCohort, transportOptions } };
      const initialBalances = initialGoalBalances(grounded, input.allowedUnitIds, input.interruptedUnitIds);
      const plannerInput: GoalPlannerInput = { context: grounded, goals: input.goals ?? collectGoalRequests(observed.objectives, grounded),
        providers: [goalEconomyActionProvider, goalLandActionProvider, goalNavalActionProvider], initialBalances,
        limits: input.limits ?? { maxDepth: 12, maxExpansions: 2048, maxPlans: 8 }, declarationRevision: 'goal-domain-v1',
        ...(retained.cache ? { previous: retained.cache } : {}), work };
      try { return run(plannerInput); }
      finally { work.flush(); preparation.factWork = structuredClone(work.receipt); boundObservationMemory(preparation); }
    });
  }));
}

/** Actual opening balances. Planned rewards/outputs enter only through flows;
 * proposed trace budgets are never mistaken for real cash reservations. */
function initialGoalBalances(context: GoalPlanningContext, allowed?: readonly string[], interrupted?: readonly string[]): GoalResourceBalance[] {
  const { snapshot, owner, tick } = context;
  const quantities = new Map<string, GoalResourceBalance>();
  const record = (observation: GoalFactObservation, resource: GoalResourceBalance['resource']) => {
    if (observation.state !== 'pending' && observation.quantity !== undefined)
      quantities.set(goalResourceKey(resource), { resource, quantity: observation.quantity, asOfTick: tick, factIds: [observation.fact.id] });
  };
  const horizon = tick + context.situation.horizonTicks;
  record(context.readFact(goalFact({ kind: 'gold', minimum: 0, byTick: horizon })), { kind: 'gold' });
  record(context.readFact(goalFact({ kind: 'supply-cap', minimum: 0 })), { kind: 'supply-cap' });
  record(context.readFact(goalFact({ kind: 'population-room', minimum: 0, byTick: horizon })), { kind: 'population-room' });
  for (const unit of snapshot.units) {
    if (unit.owner !== owner || unit.hp <= 0 || unit.expiresTick !== undefined || allowed && !allowed.includes(unit.id) || interrupted?.includes(unit.id)) continue;
    if (unit.deck || unit.cabin) continue;
    const fact = context.situation.units.find(fact => fact.id === unit.id), location = fact?.location;
    if (location?.kind !== 'land' && location?.kind !== 'sea') continue;
    const at = { point: location.point, ...(location.kind === 'land' ? { landId: location.landId } : { seaId: location.seaId }) };
    const pool = goalFact({ kind: 'unit-available', unitKind: unit.kind, count: 0, at, byTick: horizon });
    record(context.readFact(pool), { kind: 'unit-pool', unitKind: unit.kind, at });
    if (location.kind === 'land') record(context.readFact(goalFact({ kind: 'force-available', at, minimum: 0, metric: 'combat-rating', byTick: horizon })),
      { kind: 'force', at, metric: 'combat-rating', scope: 'pool' });
  }
  return [...quantities.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, balance]) => balance);
}
