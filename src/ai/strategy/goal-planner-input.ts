import { setBuildingBodies, withGoalDistanceFieldLease } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { shareShipProfile } from '../../shared/ship-geometry';
import { isTransportKind } from '../../shared/transport-role';
import type { BootstrapAiVersion, GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { withAllocationLandRoutes, type AllocationLandRouteReader } from './allocation-arrival-query';
import type { AllocationMethodQuoteInput, StrategyAllocationMemory } from './allocation-types';
import type { GoalPlanRequotation } from './goal-plan-methods';
import { reservedAllocationGold } from './allocation-ledger';
import { createArrivalPlanningPhysics } from './arrival-planning-physics';
import { createArrivalQuery } from './arrivals';
import { createPlanningDistanceQuery } from './distance-fields';
import { decisionProjection } from './explanations';
import type { DecisionFacts, StrategyDecision } from './decision';
import { currentFactWork, FactWorkQueue, withFactWork } from './fact-work';
import { withStrategyFrame } from './frame-reuse';
import { createGoalEconomicGrounding } from './goal-economy-grounding';
import { goalEconomyActionProvider } from './goal-economy-provider';
import { assessGoalCombatMovementRisk } from './goal-combat-movement-risk';
import { readGoalCampStagingFact } from './goal-camp-staging-facts';
import { createGoalCampModelUsage } from './goal-camp-default-model';
import { goalFact, goalResourceKey, goalValueKey } from './goal-facts';
import { readGoalGuardFact } from './goal-guard-facts';
import { goalPoolMemberCandidates } from './goal-pool-members';
import type { GoalGeometryMemory, GoalGeometryReader } from './goal-grounding-ports';
import { createGoalGeometryReader, retainGoalGeometryPlans, retainGoalGeometryRequests } from './goal-geometry-source';
import { goalLandActionProvider } from './goal-land-actions';
import { createGoalMovementProjection } from './goal-movement-projection';
import { createGoalLandCombatGrounding } from './goal-land-combat-grounding';
import { readGoalLandCapabilityFact } from './goal-land-facts';
import { createGoalNavalCombatGrounding } from './goal-naval-combat-grounding';
import { readGoalSiteSafetyFact } from './goal-site-safety-facts';
import { goalNavalActionProvider } from './goal-naval-provider';
import { collectGoalRequests } from './goal-requests';
import { planGoals } from './goal-planner';
import type { GoalCandidates, GoalCohortMember, GoalFactObservation, GoalGroundingReader, GoalPlannerInput,
  GoalPlannerCache, GoalPlanningContext, GoalRequest, GoalResourceBalance, GoalSearchLimits, GoalPlan, GoalEntityReference } from './goal-planner-types';
import { groundGoalTransportOptions } from './goal-transport-grounding';
import { createGoalTransportCohorts } from './goal-transport-cohorts';
import { createGoalRefinementRevision } from './goal-refinement-revision';
import { goalPostCohorts } from './goal-post-cohorts';
import { STRATEGY_PARAMETERS } from './utility';
import { chooseGoalCoarseShore, createGoalSelectedBerths, type GoalSelectedBerthMemory } from './goal-selected-berths';
import { createGoalCoarseTransport } from './goal-coarse-transport';
import { applyGoalRefinements, createGoalPlanRefiner, type GoalRefinementMemory } from './goal-plan-refinement';
import { createGoalTransportFactPorts } from './goal-transport-physical-ports';
import { createGoalVoyageRiskReader, type GoalVoyageRiskMemory } from './goal-voyage-risk-source';
import { createGoalFactReader, createGoalWorldFactMemory, type GoalWorldFactMemory } from './goal-world-facts';
import { observationJsonBytes } from './observation-json-bytes';
import { beginObservationThink, boundObservationMemory, observationHistory, observationMemory, retainObservationHistory } from './observation-memory';
import { generateStrategyObjectives } from './plan';
import { pointRoute } from './point-routes';
import { landIdAt, regionIndex, seaIdAt } from './regions';
import { evaluateSituation } from './situation';
import type { Objective, SituationObservation, StrategyPlanTrace } from './types';

export type GoalPlannerRuntimeMemory = {
  version: 1; owner: PlayerId; world: GoalWorldFactMemory; cache?: GoalPlannerCache;
  /** Separate from the observation segment: its trimmer must never evict active plan evidence. */
  geometry?: GoalGeometryMemory;
  voyageRisk?: GoalVoyageRiskMemory;
  refinements?: GoalRefinementMemory;
  selectedBerths?: GoalSelectedBerthMemory;
  requotes?: Readonly<{ key: string; cache: GoalPlannerCache }>[];
};
export type GoalPlannerOwnerInput = Readonly<{
  snapshot: GameSnapshot; owner: PlayerId; version: BootstrapAiVersion; memory: AiPolicyMemory;
  /** Omit to consume the ordinary observer's Objective list. Explicit goals
   * are for callers that already have requests, never fabricated observations. */
  goals?: readonly GoalRequest[];
  objectives?: readonly DecisionFacts<Objective>[];
  work?: FactWorkQueue; limits?: GoalSearchLimits;
  /** Diagnostic capacity measurement only; publication and the 6144 work allowance remain unchanged. */
  geometryMeasurement?: boolean;
  /** Capture explanations from this evaluation, without another observer pass. */
  captureTrace?: boolean;
  observation?: SituationObservation;
  allowedUnitIds?: readonly string[]; interruptedUnitIds?: readonly string[];
  precision?: 'coarse' | 'exact';
}>;

/** Same-think services for allocation and execution; never persist this frame. */
export type GoalPlannerNativeFrame = Readonly<{
  decision: StrategyDecision; project?: () => StrategyPlanTrace;
  executionFacts: (authority: StrategyAllocationMemory) => GoalPlanningContext['readFact'];
  objectives: readonly DecisionFacts<Objective>[]; landRoute: AllocationLandRouteReader;
  resolveReference: import('./goal-planner-types').GoalEntityResolver;
  requote: (request: Pick<AllocationMethodQuoteInput, 'unitIds' | 'valuation'>, plan: GoalPlan) => GoalPlanRequotation;
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
export function withGoalPlannerInput<T>(input: GoalPlannerOwnerInput, run: (input: GoalPlannerInput, frame: GoalPlannerNativeFrame) => T): T {
  const { snapshot, owner, memory } = input;
  const precision = input.precision ?? (input.goals === undefined ? 'coarse' : 'exact');
  return withGoalDistanceFieldLease(snapshot.map, owner, snapshot.tick, () => withStrategyFrame(() => {
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const preparation = observationMemory(snapshot, owner, memory);
    const work = input.work ?? currentFactWork() ?? new FactWorkQueue(snapshot.tick, 6144, preparation.factWork, beginObservationThink(preparation));
    return withFactWork(work, () => {
      const regions = regionIndex(snapshot.map), distances = createPlanningDistanceQuery(snapshot, 1, 'land', preparation);
      let retained = memory.goalPlanning;
      if (!retained || retained.version !== 1 || retained.owner !== owner) {
        retained = { version: 1, owner, world: createGoalWorldFactMemory(owner) };
        memory.goalPlanning = retained;
      }
      retained.geometry ??= preparation.goalGeometry ?? { version: 1, entries: [] };
      delete preparation.goalGeometry; // migrate older memories before observation trimming
      const rawGeometry = createGoalGeometryReader({ tick: snapshot.tick, work, memory: retained.geometry,
        ...(input.geometryMeasurement ? { measurement: true } : {}) });
      const readVoyageRisk = createGoalVoyageRiskReader({ snapshot, owner, work, observation: preparation,
        memory: retained.voyageRisk ??= { model: { version: 1, owner, tick: -1, routeIds: [], entries: [] }, publications: [] } });
      const worldGeometry = [preparation.terrain, preparation.landBodies,
        snapshot.buildings.map(building => [building.id, building.owner, building.kind, building.hp > 0, building.complete])];
      const geometryRevision = rawGeometry.reference!('world-geometry', worldGeometry);
      const berthBindings = createGoalSelectedBerths({ memory: retained.selectedBerths ??= { revision: 0, nextId: 1, sources: [], entries: [] },
        geometryRevision: goalValueKey(worldGeometry), regions, units: snapshot.units,
        currentPlanIds: () => work.consumerPlanIds().map(id => `goal-plan:${id}`),
        ...(precision === 'coarse' ? { berthOrientation: 'shore' as const } : {}) });
      const contactPreparation = new WeakMap<GoalPlanningContext,
        (plan: GoalPlan, selected: GoalPlan['actions']) => ReturnType<typeof berthBindings.prepare>>();
      const geometry: GoalGeometryReader = Object.assign(<State, Value>(request: import('./goal-grounding-ports').GoalGeometryRequest<State, Value>) =>
        rawGeometry({ ...request, references: [...new Set([geometryRevision, ...(request.references ?? [])])] }),
      { reference: rawGeometry.reference! });
      const readLandRoute = (from: import('./types').Point, goal: import('./types').Point, requestWork: boolean): ReturnType<AllocationLandRouteReader> => {
        const published = distances.field(goal, requestWork);
        if (!published) return { status: 'unknown', reasonCode: 'goal-land-route-pending' };
        const distance = published.field.cost(from), points = published.field.road(from, goal);
        return distance === undefined || !points ? { status: 'unreachable', reasonCode: 'goal-land-route-unreachable' }
          : { status: 'known', distance, points };
      };
      const landRoute: AllocationLandRouteReader = (from, goal) => readLandRoute(from, goal, precision !== 'coarse');
      const exactLandRoute: AllocationLandRouteReader = (from, goal) => readLandRoute(from, goal, true);
      const arrivalPhysics = createArrivalPlanningPhysics({ snapshot, geometry, geometryRevision, landRoute: exactLandRoute, regions });
      const observationDistances = precision === 'coarse' ? { ...distances, field: (goal: import('./types').Point) => distances.field(goal, false) } : distances;
      const arrivals = createArrivalQuery(snapshot, owner, memory, distances, 1, regions, preparation, false, arrivalPhysics);
      const coarseSeaTicks: NonNullable<import('./goal-naval-combat-grounding').GoalNavalCombatGroundingPorts['coarseSeaTicks']> = (ship, from, to, future) => {
        const factIds = [`field:sea:${to.x}:${to.y}`], sea = seaIdAt(snapshot.map, from);
        if (!sea || sea !== seaIdAt(snapshot.map, to)) return { state: 'unmet', reason: {
          code: 'coarse-sea-components-differ', factIds, values: {} } };
        const quote = arrivals.coarseSeaTravel(ship, from, to, future);
        if (quote.status === 'known') return { state: 'met', value: quote.ticks, factIds };
        if (quote.status === 'unreachable') return { state: 'unmet', reason: {
          code: 'coarse-published-sea-field-unreachable', factIds, values: {} } };
        // An unbuilt field supplies no forecast. Zero is only the admissible
        // search lower bound while the chosen frontier publishes that field;
        // it never proves arrival, a dock pose, risk or a native route.
        return { state: 'met', value: 0, factIds: [...factIds, 'coarse-unpublished-sea-time-lower-bound'] };
      };
      const observationArrivals = precision === 'coarse' ? { ...arrivals,
        arrival: (_unit: import('../../shared/types').Unit, _target: import('./types').Target): import('./types').Arrival => ({
          status: 'unknown', lowerBoundTicks: 0, reason: { code: 'coarse-arrival-not-refined',
            detail: 'Exact arrival follows selected-plan refinement', evidence: [] } }),
        freeInTicks: () => null,
      } : arrivals;
      const projectGround = (point: { x: number; y: number }, mover: 'land' | 'sea') => {
        if (precision === 'coarse') return mover === 'land' ? landIdAt(snapshot.map, point) ? point : undefined : seaIdAt(snapshot.map, point) ? point : undefined;
        const result = arrivalPhysics.ground({ kind: 'project-goal', point, mover });
        return result.state === 'met' ? result.value : undefined;
      };
      // This is the sole Situation evaluation. In an actual owner think the
      // caller supplies the ordinary planner's accepted healing observations;
      // an isolated cold frame has none, and never previews old selectors.
      const projection = decisionProjection(() => {
        const situation = evaluateSituation(snapshot, owner, memory, observationHistory(preparation),
          snapshot.teams, 1, input.observation ?? { healing: [] }, preparation, { regions, distances: observationDistances, arrivals: observationArrivals, projectGround });
        const objectives = input.objectives ?? (input.goals === undefined
          ? generateStrategyObjectives(situation, { snapshot, owner, memory, ...(snapshot.teams ? { teams: snapshot.teams } : {}) }, preparation.history?.objectives)
            .map(entry => entry.objective) : []);
        retainObservationHistory(preparation, situation, objectives as readonly Objective[]);
        return { schemaVersion: 1 as const, tick: snapshot.tick, owner, mode: 'control' as const, situation, objectives,
          feasibleObjectiveIds: [], blockedObjectives: [], methods: [], assignments: [], preemptions: [], budget: [], idleForces: [],
          limitations: situation.limitations } satisfies StrategyDecision;
      }, input.captureTrace === true);
      const observed = projection.facts;
      const { situation } = observed;
      const campModelUsage = createGoalCampModelUsage();
      const regionAt = (point: { x: number; y: number }, mover: 'land' | 'sea') => mover === 'land'
        ? landIdAt(snapshot.map, point) : seaIdAt(snapshot.map, point);
      const reservedGold = memory.strategyAllocation?.owner === owner ? reservedAllocationGold(memory.strategyAllocation) : 0;
      const ownerGeometry = geometry;
      function makeContext(allowedUnitIds?: readonly string[], interruptedUnitIds?: readonly string[],
        unavailableProduction: readonly import('./types').ProductionUse[] = [], reserved = reservedGold,
        mode: 'coarse' | 'exact' = precision, selected: readonly import('./goal-planner-types').GoalActionDeclaration[] = [],
        prefix: Parameters<NonNullable<GoalPlannerInput['contextForPrefix']>>[0] = []): GoalPlanningContext {
        // Unsupported coarse-domain branches suspend without registering any
        // precise geometry. They cannot quietly spend the refinement allowance.
        const geometry: GoalGeometryReader = mode === 'exact' ? ownerGeometry : request => ({ state: 'pending',
          requestIds: [`coarse-geometry:${request.key}`], reason: { code: 'coarse-provider-metadata-required', factIds: [], values: {} } });
        const landRoute: AllocationLandRouteReader = mode === 'exact' ? exactLandRoute : (from, goal) =>
          landIdAt(snapshot.map, from) === landIdAt(snapshot.map, goal) ? { status: 'known', distance: Math.hypot(from.x - goal.x, from.y - goal.y), points: [from, goal] }
            : { status: 'unreachable', reasonCode: 'coarse-land-components-differ' };
        const arrivalPhysics = createArrivalPlanningPhysics({ snapshot, geometry, geometryRevision, landRoute: exactLandRoute, regions });
        const context: GoalPlanningContext = { snapshot, owner, tick: snapshot.tick, version: input.version, situation,
          precision: mode, ...(precision === 'coarse' ? { planThroughTick: snapshot.tick + STRATEGY_PARAMETERS.knownThreatHorizonTicks } : {}), readFact: fact => read(fact) };
        const worldReader = (worldSnapshot: GameSnapshot) => createGoalFactReader({ ...context, snapshot: worldSnapshot, memory: retained!.world,
          ...(allowedUnitIds === undefined ? {} : { allowedUnitIds: allowedUnitIds }),
          ...(interruptedUnitIds === undefined ? {} : { interruptedUnitIds: interruptedUnitIds }),
          ports: { geometry, geometryRevision, regionAt, reservedGold: reserved,
            landRoute,
            seaRoute: (predicate, actor) => {
              const fact = goalFact(predicate), ship = { ...actor, sailing: { ...actor.sailing!,
                heading: predicate.fromHeading ?? actor.sailing?.heading ?? 0 } };
              shareShipProfile(actor, ship);
              const future = actor.x !== predicate.from.point.x || actor.y !== predicate.from.point.y
                || predicate.fromHeading !== undefined && predicate.fromHeading !== actor.sailing?.heading;
              if (future) { delete ship.sailing.route; delete ship.sailing.planningJob; }
              const result = pointRoute(snapshot, preparation, ship, predicate.from.point, predicate.to.point, future, precision === 'coarse');
              const revision = goalValueKey([fact.id, geometryRevision, result]);
              if (result.status === 'complete') {
                const points = [predicate.from.point, ...result.route.points];
                const distance = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0);
                return { fact, state: 'met', observedTick: snapshot.tick, revision, evidence: [], availableTick: snapshot.tick,
                  reason: { code: 'native-sea-route-published', factIds: [fact.id], values: {} }, route: { distance, ticks: result.ticks, points } };
              }
              if (precision === 'coarse' && mode === 'exact') {
                const sea = seaIdAt(snapshot.map, predicate.from.point);
                if (sea && sea === seaIdAt(snapshot.map, predicate.to.point)) {
                  const distance = Math.hypot(predicate.to.point.x - predicate.from.point.x, predicate.to.point.y - predicate.from.point.y);
                  const time = coarseSeaTicks(ship, predicate.from.point, predicate.to.point, future);
                  if (time.state !== 'met') return { fact, observedTick: snapshot.tick, revision, evidence: [], reason: time.reason,
                    ...(time.state === 'pending' ? { state: 'pending' as const, requestId: time.requestIds[0] ?? fact.id, requestedTick: snapshot.tick }
                      : { state: 'unmet' as const }) };
                  return { fact, state: 'met', observedTick: snapshot.tick, revision, evidence: [], availableTick: snapshot.tick,
                    reason: { code: 'sea-component-connected-native-time-background', factIds: [fact.id],
                      values: { timing: time.factIds.includes('coarse-unpublished-sea-time-lower-bound') ? 'unpublished-field-lower-bound' : 'published-sea-field-wind-estimate', nativeStatus: result.status } },
                    route: { distance, ticks: time.value, points: [] } };
                }
              }
              const common = { fact, observedTick: snapshot.tick, revision, evidence: [],
                reason: { code: result.reasonCode, factIds: [fact.id], values: {} } };
              return result.status === 'static-infeasible' ? { ...common, state: 'unmet' }
                : { ...common, state: 'pending', requestId: `point:${fact.id}`, requestedTick: snapshot.tick };
            },
            resolvers: [(fact, factsContext) => readGoalLandCapabilityFact(fact, factsContext, {
              regionAt: point => landIdAt(snapshot.map, point) ?? null,
            }), (fact, factsContext) => readGoalSiteSafetyFact(fact, factsContext, { regionAt,
              ...(mode === 'exact' ? { readThreatArrival: (unit: import('../../shared/types').Unit, target: import('./types').Target) =>
                arrivals.arrival(unit, target, landIdAt(snapshot.map, unit)) } : {}),
            }), (fact, factsContext) => readGoalCampStagingFact(fact, factsContext, {
              landRoute, readGroundPoint: arrivalPhysics.ground,
              resolveCohort: references => resolveSnapshotCohort(worldSnapshot, references),
            })],
          } });
        const baseRead = worldReader(snapshot);
        const read: GoalPlanningContext['readFact'] = fact => {
          const guard = readGoalGuardFact(fact, context, memory.strategyAllocation, allowedUnitIds, interruptedUnitIds);
          if (guard?.state === 'met') return guard;
          const p = fact.predicate;
          // The proposal carries the full requested protection window. Its
          // threat set is relaxed to the cached observation support only;
          // exact refinement must prove the original full-window predicate.
          const boundedSafety = mode === 'coarse' && (p.kind === 'site-safe' || p.kind === 'shore-safe')
            && p.throughTick > snapshot.tick + situation.horizonTicks;
          const observedSafety = boundedSafety ? baseRead(goalFact({ ...p, throughTick: snapshot.tick + situation.horizonTicks })) : null;
          const value = observedSafety ? { ...observedSafety, fact, revision: `coarse-safety:${observedSafety.revision}`,
            reason: { code: 'coarse-safety-observed-window-bound', factIds: observedSafety.reason.factIds,
              values: { precision: 'coarse', requestedThroughTick: p.kind === 'site-safe' || p.kind === 'shore-safe' ? p.throughTick : null,
                observedThroughTick: snapshot.tick + situation.horizonTicks } } } : baseRead(fact);
          if (guard && value.state !== 'met') return guard;
          if (p.kind !== 'production' || p.producer?.kind !== 'existing' || value.state !== 'met') return value;
          const producerId = p.producer.entityId;
          const occupied = unavailableProduction.filter(use => use.buildingId === producerId && use.lane === 'training');
          if (!occupied.length) return value;
          const availableTick = Math.max(value.availableTick ?? snapshot.tick, ...occupied.map(use => snapshot.tick + use.throughTicks));
          return { ...value, availableTick, revision: goalValueKey([value.revision, occupied]),
            reason: { code: 'counterfactual-production-occupied-until', factIds: [fact.id], values: { availableTick } } };
        };
        const resolveSnapshotCohort = (worldSnapshot: GameSnapshot, references: Parameters<NonNullable<GoalGroundingReader['resolveCohort']>>[0]): ReturnType<NonNullable<GoalGroundingReader['resolveCohort']>> => {
          const members: GoalCohortMember[] = [];
          for (const reference of references) {
            if (reference.kind !== 'existing') return { state: 'pending', requestIds: [`output-shape:${goalValueKey(reference)}`],
              reason: { code: 'goal-output-assessment-binding-required', factIds: [], values: {} } };
            const assessment = worldSnapshot.units.find(unit => unit.id === reference.entityId && unit.owner === owner && unit.hp > 0
              && (allowedUnitIds === undefined || allowedUnitIds.includes(unit.id)) && !interruptedUnitIds?.includes(unit.id));
            if (!assessment) return { state: 'unmet', reason: { code: 'goal-cohort-member-unavailable', factIds: [reference.entityId], values: {} } };
            members.push({ reference, assessment });
          }
          return { state: 'met', candidates: members, factIds: members.map(member => member.assessment.id) };
        };
        const resolveCohort: NonNullable<GoalGroundingReader['resolveCohort']> = references => resolveSnapshotCohort(snapshot, references);
        const economy = createGoalEconomicGrounding(context, { geometry, geometryRevision, regionAt,
          cohortOptions: effect => cohortOptions(effect) });
        const hullReferences = selected.flatMap(action => {
          const ref = action.executor.parameters.transport;
          return ref && typeof ref === 'object' && !Array.isArray(ref) && 'kind' in ref
            ? [ref as GoalEntityReference] : [];
        });
        const rawPhysical = createGoalTransportFactPorts({ snapshot, owner, tick: snapshot.tick, byTick: context.planThroughTick ?? snapshot.tick + situation.horizonTicks,
          regions, geometry, geometryRevision, shoreGeometryRevision: preparation.terrain,
          ...(selected.length ? { hullReferences } : {}),
          ...(precision === 'coarse' && mode === 'exact' ? { travelTimePolicy: 'connectivity-estimate' as const } : {}),
          ...(precision === 'coarse' ? { berthOrientation: 'shore' as const } : {}),
          readFact: read, resolveCohort, productionOptions: economy.productionOptions, readGroundPoint: arrivalPhysics.ground, readVoyageRisk, coarseSeaTicks,
          readPointRoute: (ship, from, to, future) => {
            const pose = { ...ship, sailing: { ...ship.sailing!, heading: from.heading } };
            shareShipProfile(ship, pose);
            return { id: `point:${goalValueKey([ship.kind, from, to, future])}`, fact: pointRoute(snapshot, preparation, pose, from, to, future, precision === 'coarse') };
          } });
        const physical = { ...rawPhysical,
          berth: (...args: Parameters<typeof rawPhysical.berth>) => {
            const [passenger, hull, shore, preferredPose] = args;
            const hullId = hull.reference.kind === 'existing' ? hull.reference.entityId : undefined;
            const actor = snapshot.units.find(unit => unit.id === hullId);
            const parent = selected.find(action => ['transport-force', 'transport-worker'].includes(action.kind)
              && (action.executor.parameters.transport as GoalEntityReference | undefined)?.kind === 'existing'
              && (action.executor.parameters.transport as { entityId: string }).entityId === hullId
              && (action.executor.parameters.cohort as readonly GoalEntityReference[]).some(ref => ref.kind === 'existing' && ref.entityId === passenger.id));
            const members = parent && resolveCohort(parent.executor.parameters.cohort as readonly GoalEntityReference[]);
            const proposal = actor && members?.state === 'met' ? berthBindings.published.proposal?.(actor, members.candidates, shore) : undefined;
            return rawPhysical.berth(passenger, hull, shore, preferredPose ?? (proposal ? { ...proposal.water, heading: proposal.heading } : undefined));
          }, shores: (from: import('./types').Target, to: import('./types').Target): ReturnType<typeof rawPhysical.shores> => {
          if (!selected.length) return rawPhysical.shores(from, to);
          const choices = selected.filter(action => ['transport-force', 'transport-worker'].includes(action.kind)
            && (action.executor.parameters.at as import('./types').Target | undefined)?.landId === to.landId);
          const action = choices.find(action => goalValueKey(action.executor.parameters.from) === goalValueKey(from)) ?? choices[0];
          if (!action) return { state: 'pending', requestIds: ['selected-shore-not-yet-needed'],
            reason: { code: 'selected-shore-not-yet-needed', factIds: [], values: {} } };
          const p = action.executor.parameters, departure = p.departure as { ground?: import('./types').Point; water: import('./types').Point };
          const landing = p.landing as { ground: import('./types').Point; water: import('./types').Point };
          const seaId = from.seaId ?? seaIdAt(snapshot.map, departure.water);
          const reference = p.transport as GoalEntityReference | undefined;
          const ship = reference?.kind === 'existing' ? snapshot.units.find(unit => unit.id === reference.entityId) : undefined;
          const members = resolveCohort(p.cohort as readonly GoalEntityReference[]);
          const contact = (landId: import('./types').LandId, near: import('./types').Point) => ship && members.state === 'met'
            ? chooseGoalCoarseShore(regions.shoresByLand.get(landId)?.get(seaId!) ?? [], near, ship, members.candidates, berthBindings.published)?.shore
            : undefined;
          const end = to.landId && contact(to.landId, to.point), start = from.landId && departure.ground ? contact(from.landId, departure.ground) : undefined;
          return seaId && end && (!from.landId || start) ? { state: 'met', candidates: [{ id: `selected-shore:${action.id}`, seaId,
            ...(start ? { departure: start } : {}), landing: end }], factIds: [] } : { state: 'unmet',
            reason: { code: 'selected-shore-contact-invalid', factIds: [], values: {} } };
        } };
        const transportOptions: GoalGroundingReader['transportOptions'] = mode === 'coarse' ? createGoalCoarseTransport(context, regions, resolveCohort, berthBindings.published, coarseSeaTicks) : (from, to, _mass, request) => {
          if (!request) return { state: 'pending', requestIds: ['transport-exact-cohort'],
            reason: { code: 'transport-exact-cohort-required', factIds: [], values: {} } };
          const members = resolveCohort(request.cohort);
          return groundGoalTransportOptions({ snapshot, owner, tick: snapshot.tick, byTick: context.planThroughTick ?? snapshot.tick + situation.horizonTicks,
            from, to, request, members: members.state === 'met' ? { state: 'met', value: members.candidates, factIds: members.factIds } : members,
            ports: physical, readFact: read });
        };
        const transportCohorts = createGoalTransportCohorts(context, { transportOptions,
          ...(allowedUnitIds === undefined ? {} : { allowedUnitIds }),
          ...(interruptedUnitIds === undefined ? {} : { interruptedUnitIds }) });
        const cohortOptions: NonNullable<GoalGroundingReader['cohortOptions']> = effect => {
          const posts = goalPostCohorts(effect, context, prefix), landings = transportCohorts(effect);
          if (!posts.length) return landings;
          return { state: 'met', candidates: [...posts, ...(landings.state === 'met' ? landings.candidates : [])],
            factIds: posts.flatMap(post => post.factIds), ...(landings.state === 'met' && landings.deferred ? { deferred: landings.deferred }
              : landings.state === 'pending' ? { deferred: [{ id: `post-alternative:${effect.id}`, requestIds: landings.requestIds, reason: landings.reason }] } : {}) };
        };
        const combatPorts = { landRoute, resolveCohort, coarseSeaTicks,
          movementRisk: request => mode === 'coarse' ? { state: 'met', value: { expectedLossGold: 0, survivalProbability: 1 }, factIds: ['coarse-movement-bound'] }
            : assessGoalCombatMovementRisk({ snapshot, situation, request }),
          arrival: (unit, target) => mode === 'coarse' ? { status: 'unknown', lowerBoundTicks: 0,
            reason: { code: 'coarse-arrival-not-refined', detail: 'Exact arrival follows selected-plan refinement', evidence: [] } }
            : arrivals.arrival(unit, target, landIdAt(snapshot.map, unit)),
          ...(allowedUnitIds === undefined ? {} : { allowedUnitIds: allowedUnitIds }),
          ...(interruptedUnitIds === undefined ? {} : { interruptedUnitIds: interruptedUnitIds })
        } satisfies import('./goal-naval-combat-grounding').GoalNavalCombatGroundingPorts;
        const naval = createGoalNavalCombatGrounding(context, { ...combatPorts, readGroundPoint: arrivalPhysics.ground,
          cohortOptions, transportFacts: physical, onCampModelSelection: campModelUsage.observe });
        const land = createGoalLandCombatGrounding(context, combatPorts);
        const combatOptions: NonNullable<GoalGroundingReader['combatOptions']> = effect => {
          const kind = effect.predicate.kind;
          return (kind === 'enemy-site-destroyed' || kind === 'route-controlled' || kind === 'harassment-ended'
            ? land : naval).combatOptions!(effect);
        };
        const grounded: GoalPlanningContext = { ...context, readProjectedFact: createGoalMovementProjection(context, worldReader),
          grounding: { ...economy, combatOptions, resolveCohort, transportOptions, cohortOptions } };
        if (mode === 'exact') contactPreparation.set(grounded, (plan, selected) => berthBindings.prepare(plan, selected, rawPhysical, resolveCohort));
        return grounded;
      }
      const grounded = makeContext(input.allowedUnitIds, input.interruptedUnitIds);
      const initialBalances = initialGoalBalances(grounded, input.allowedUnitIds, input.interruptedUnitIds);
      const goals = input.goals ?? collectGoalRequests(observed.objectives, grounded);
      retainGoalGeometryPlans(retained.geometry, goals.map(goal => goal.id));
      berthBindings.retain(goals.map(goal => `goal-plan:${goal.id}`));
      const refinements = retained.refinements ??= { revision: 0, entries: [] };
      const baseProviders = [goalEconomyActionProvider, goalLandActionProvider, goalNavalActionProvider];
      // A resident reference handle may be collected when no geometry task
      // uses it. Quote validity follows the native geometry bytes, not that
      // handle's allocation/lifetime in the bounded publication cache.
      const actorRevision = createGoalRefinementRevision(snapshot, owner, goalValueKey(worldGeometry));
      const sourceRevision = (action: import('./goal-planner-types').GoalActionDeclaration) => {
        const transport = action.executor.parameters.transport as GoalEntityReference | undefined;
        const times = transport?.kind === 'existing' ? preparation.pointRoutes?.entries.filter(entry =>
          entry.id.startsWith(`${transport.entityId}:`) && entry.readyTick !== null).map(entry => [entry.id, entry.readyTick, entry.readyThink]) : [];
        const fields = transport ? preparation.fields.sea.filter(entry => entry.readyTick !== null)
          .map(entry => [entry.goal, entry.readyTick, entry.readyThink]) : [];
        return goalValueKey([actorRevision(action), times, fields, ...(transport ? [snapshot.map.wind] : [])]);
      };
      const refiner = createGoalPlanRefiner({ memory: refinements, providers: baseProviders, sourceRevision,
        maxAlternativeQuotes: input.limits?.maxPlans ?? 8,
        exactContext: (_selected, plan) => makeContext(input.allowedUnitIds, input.interruptedUnitIds, [], reservedGold, 'exact', plan.actions.map(node => node.declaration)),
        prepareExact: (plan, selected, context) => {
          for (const node of selected) {
            const parameters = node.declaration.executor.parameters;
            if (node.declaration.kind === 'position-transport') {
              const at = parameters.at as import('./types').Target;
              if (at?.seaId) arrivals.prepareSeaField(at.point);
            } else if (['transport-force', 'transport-worker'].includes(node.declaration.kind)) {
              const landing = parameters.landing as { water?: import('./types').Point } | undefined;
              if (landing?.water) arrivals.prepareSeaField(landing.water);
            }
          }
          return contactPreparation.get(context)?.(plan, selected);
        } });
      const prefixContexts = new WeakMap<object, GoalPlanningContext>();
      const quoteRevision = () => `goal-domain-v3:${precision}:${refinements.revision}:berths:${retained.selectedBerths!.revision}:sea:${goalValueKey(preparation.fields.sea.filter(entry => entry.readyTick !== null).map(entry => [entry.goal, entry.readyTick, entry.readyThink]))}`;
      const plannerInput: GoalPlannerInput = { context: grounded, goals,
        campModelUsage: () => ({ ...campModelUsage.counts }),
        ...(precision === 'coarse' ? { refinementRevision: quoteRevision } : {}),
        retainFactRequests: plans => {
          if (precision !== 'coarse') return;
          const ids = (value: unknown, found = new Set<string>()): Set<string> => {
            if (typeof value === 'string' && value.startsWith('goal-geometry:')) found.add(value);
            else if (Array.isArray(value)) value.forEach(item => ids(item, found));
            else if (value && typeof value === 'object') Object.values(value).forEach(item => ids(item, found));
            return found;
          };
          retainGoalGeometryRequests(retained.geometry!, plans.map(plan => ({ planId: plan.goal.id,
            requestIds: [...ids([plan.actions, plan.deferredCandidates ?? [], berthBindings.requests(plan.id)])] })), work.receipt.thinkSequence ?? snapshot.tick);
        },
        capacityPressure: () => retained.geometry?.capacity?.pressure ? [retained.geometry.capacity.pressure] : [],
        providers: precision === 'coarse' ? baseProviders.map(provider => applyGoalRefinements(provider, refinements, sourceRevision)) : baseProviders, initialBalances,
        ...(precision === 'coarse' ? { refineSelected: refiner, contextForPrefix: prefix => {
          let context = prefixContexts.get(prefix);
          if (!context) { context = makeContext(input.allowedUnitIds, input.interruptedUnitIds, [], reservedGold, 'coarse', [], prefix); prefixContexts.set(prefix, context); }
          return context;
        } } : {}),
        limits: input.limits ?? { maxDepth: 12, maxExpansions: 2048, maxPlans: 8 }, declarationRevision: quoteRevision(),
        ...(retained.cache ? { previous: retained.cache } : {}), work };
      let active = true;
      const assertActive = () => { if (!active || currentFactWork() !== work) throw Error('Goal native frame is outside its owner-think scope'); };
      const frame: GoalPlannerNativeFrame = { decision: observed,
        ...(projection.explain ? { project: (): StrategyPlanTrace => {
          const result = projection.explain!();
          return { ...result, objectives: result.objectives as readonly Objective[] };
        } } : {}),
        objectives: observed.objectives, landRoute: exactLandRoute,
        executionFacts(authority) {
          assertActive();
          if (authority.owner !== owner || authority.evaluatedTick !== snapshot.tick) throw Error('Goal execution authority epoch mismatch');
          return makeContext(input.allowedUnitIds, input.interruptedUnitIds, [], reservedAllocationGold(authority), 'exact').readFact;
        },
        resolveReference(reference, selection) {
          assertActive();
          if (reference.kind === 'pool-member') {
            const unit = goalPoolMemberCandidates({ snapshot, owner, reference, allowedUnitIds: input.allowedUnitIds,
              interruptedUnitIds: input.interruptedUnitIds, excludedUnitIds: selection?.excludedUnitIds })[0];
            return unit ? { kind: 'existing', entityId: unit.id } : null;
          }
          if (reference.kind === 'existing') return [...snapshot.units, ...snapshot.buildings].some(entity =>
            entity.id === reference.entityId && entity.owner === owner && entity.hp > 0) ? reference : null;
          if (reference.kind !== 'output') return null;
          const action = Object.values(memory.strategyAllocation?.executions ?? {}).find(action => action.intent.kind === 'goal-action'
            && action.intent.declarationId === reference.actionId);
          const bindings = action?.state.goalOutputBindings;
          const entityId = bindings && typeof bindings === 'object' && !Array.isArray(bindings) ? (bindings as Readonly<Record<string, unknown>>)[reference.output] : undefined;
          return typeof entityId === 'string' && snapshot.buildings.some(building => building.id === entityId && building.owner === owner && building.hp > 0)
            ? { kind: 'existing', entityId } : null;
        },
        requote(request, plan) {
          assertActive();
          if (plan.goal.owner !== owner) throw Error('Goal requote owner mismatch');
          const unavailable = [...new Set(request.valuation?.unavailableUnitIds ?? [])].sort();
          const production = request.valuation?.unavailableProduction ?? [];
          const allowed = (input.allowedUnitIds ?? snapshot.units.filter(unit => unit.owner === owner && unit.hp > 0).map(unit => unit.id))
            .filter(id => !unavailable.includes(id));
          const key = goalValueKey([plan.goal.id, allowed, input.interruptedUnitIds ?? [], production]);
          const context = makeContext(allowed, input.interruptedUnitIds, production);
          const previous = retained!.requotes?.find(entry => entry.key === key)?.cache;
          const { previous: _grossPrevious, ...base } = plannerInput;
          const result = planGoals({ ...base, context, goals: [plan.goal],
            initialBalances: initialGoalBalances(context, allowed, input.interruptedUnitIds),
            searchScope: `goal-requote:${key}`, ...(previous ? { previous } : {}) });
          const saved = [...(retained!.requotes ?? []).filter(entry => entry.key !== key), { key, cache: result.cache }];
          // Counterfactual continuations have their own finite evidence segment.
          // Eviction loses proof and resumes pending; it never creates zero loss.
          while (saved.length > 8 || observationJsonBytes(saved) > 256 * 1024) saved.shift();
          retained!.requotes = saved;
          const updated = result.plans[0];
          return updated?.status === 'ready' || updated?.status === 'complete' ? { state: 'known', plan: updated }
            : { state: updated?.status === 'blocked' ? 'unmet' : 'pending',
              reason: { code: updated?.reasons[0]?.code ?? 'goal-counterfactual-facts-pending', factIds: [plan.id], values: {} } };
        } };
      try { return withAllocationLandRoutes(exactLandRoute, () => run(plannerInput, frame)); }
      finally { try { work.flush(); preparation.factWork = structuredClone(work.receipt); boundObservationMemory(preparation); } finally { active = false; } }
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
    if (location.kind === 'sea' && isTransportKind(unit.kind)) {
      const transport = { kind: 'existing' as const, entityId: unit.id };
      record(context.readFact(goalFact({ kind: 'transport-in', seaId: location.seaId, transport, capacity: 0, byTick: horizon })),
        { kind: 'transport-capacity', seaId: location.seaId, transport });
    }
    if (location.kind === 'land') record(context.readFact(goalFact({ kind: 'force-available', at, minimum: 0, metric: 'combat-rating', byTick: horizon })),
      { kind: 'force', at, metric: 'combat-rating', scope: 'pool' });
  }
  return [...quantities.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, balance]) => balance);
}
