import type { BootstrapAiVersion, BuildingKind, GameSnapshot, PlayerId, Unit, UnitKind } from '../../shared/types';
import type { AllocationReason } from './allocation-types';
import type { FactWorkQueue } from './fact-work';
import type { DecisionFacts } from './decision';
import type { Evidence, LandId, SeaId, Situation, Target } from './types';

/** Shared contract for goal regression. These are world predicates, never
 * task states. IDs are canonical value keys of the entire predicate. */
export type GoalFactState = 'met' | 'unmet' | 'pending';
export type GoalForceMetric = 'combat-rating' | 'field-strength' | 'camp-force';
export type GoalForceMeasure = Readonly<{ metric: 'combat-rating' }>
  /** Existing observer field strength is a separate currency. It must never
   * be relabelled as additive native combat-rating. */
  | Readonly<{ metric: 'field-strength' }>
  | Readonly<{ metric: 'camp-force'; campId: string }>;
/** A fungible regional pool slot, not a prospective entity or a training-job
 * identity. The optional movement profile constrains an already priced route;
 * it never asserts that a member has arrived. Allocation resolves the slot to
 * one live eligible entity before issuing its normal unit lease. */
export type GoalPoolMemberReference = Readonly<{
  kind: 'pool-member'; unitKind: UnitKind; at: Target; slot: string;
  routeProfile?: Readonly<{ from: Target['point']; speed: number }>;
}>;
export type GoalEntityReference = Readonly<{ kind: 'existing'; entityId: string }>
  /** Exact building/foundation output. Trained troops and hulls enter a
   * regional quantity pool and are selected as actual units by allocation. */
  | Readonly<{ kind: 'output'; actionId: string; output: string }>
  /** Template-local variable unified with an achiever's existing/output ref. */
  | Readonly<{ kind: 'binding'; name: string }>
  | GoalPoolMemberReference;
export type GoalEntityResolver = (reference: GoalEntityReference,
  selection?: Readonly<{ excludedUnitIds: readonly string[] }>) => Extract<GoalEntityReference, { kind: 'existing' }> | null;
export type GoalFactPredicate =
  | Readonly<{ kind: 'force-at'; at: Target; minimum: number; byTick: number; cohort?: readonly GoalEntityReference[] } & GoalForceMeasure>
  | Readonly<{ kind: 'force-available'; at: Target; minimum: number; byTick: number; cohort?: readonly GoalEntityReference[] } & GoalForceMeasure>
  /** Capacity is native payload mass, never a passenger head count. */
  | Readonly<{ kind: 'transport-in'; seaId: SeaId; capacity: number; byTick: number; transport?: GoalEntityReference }>
  | Readonly<{ kind: 'transport-at'; transport: GoalEntityReference; at: Target; tolerance: number; byTick: number }>
  | Readonly<{ kind: 'shipyard-for'; seaId: SeaId }>
  | Readonly<{ kind: 'production'; unitKind: UnitKind; at?: Target; producer?: GoalEntityReference; byTick: number }>
  | Readonly<{ kind: 'gold'; minimum: number; byTick: number }>
  | Readonly<{ kind: 'worker-at'; at: Target; count: number; byTick: number; worker?: GoalEntityReference }>
  | Readonly<{ kind: 'cargo-aboard'; transport: GoalEntityReference; units: readonly GoalEntityReference[] }>
  | Readonly<{ kind: 'shore-safe'; landId: LandId; landing: Target; throughTick: number }>
  | Readonly<{ kind: 'camp-cleared'; campId: string }>
  /** Native gathering/retreat geometry for this camp. This predicate does not
   * assert that the camp's combat exposure is absent during the attack. */
  | Readonly<{ kind: 'camp-staging'; campId: string; at: Target; cohort?: readonly GoalEntityReference[] }>
  /** A legal gathering point, distinct from a promise that no hostile can
   * expose its occupants. Route/battle risk is priced separately. */
  | Readonly<{ kind: 'assembly-post'; at: Target; cohort?: readonly GoalEntityReference[] }>
  | Readonly<{ kind: 'hall-complete'; mineId: string; at: Target }>
  | Readonly<{ kind: 'garrison-ready'; mineId: string; at: Target; throughTick?: number }>
  | Readonly<{ kind: 'site-safe'; site: Target; throughTick: number }>
  // Capacity unlocks a production tier; free room pays the new unit's slots.
  | Readonly<{ kind: 'supply-cap'; minimum: number }>
  | Readonly<{ kind: 'population-room'; minimum: number; byTick: number }>
  | Readonly<{ kind: 'build-site'; buildingKind: BuildingKind; at: Target }>
  | Readonly<{ kind: 'spawn-exit'; producer: GoalEntityReference; unitKind: UnitKind; toward: Target }>
  | Readonly<{ kind: 'route'; mover: 'land' | 'sea'; from: Target; to: Target; actor?: GoalEntityReference;
      fromHeading?: number; toHeading?: number }>
  // Callable mover-region pool (land troops / sea ships), not exact arrival.
  | Readonly<{ kind: 'unit-available'; unitKind: UnitKind; count: number; at: Target; byTick: number }>
  | Readonly<{ kind: 'building-complete'; buildingKind: BuildingKind; at: Target; building?: GoalEntityReference }>
  | Readonly<{ kind: 'enemy-site-destroyed'; site: Target }>
  | Readonly<{ kind: 'route-controlled'; at: Target; throughTick: number }>
  | Readonly<{ kind: 'harassment-ended'; site: Target; throughTick: number; unitIds?: readonly string[] }>
  | Readonly<{ kind: 'interception-capability'; site: Target; throughTick: number; cohort?: readonly GoalEntityReference[] }>
  | Readonly<{ kind: 'assets-safe'; unitIds: readonly string[]; at: Target; throughTick: number }>;

export type GoalFact = Readonly<{ id: string; predicate: GoalFactPredicate }>;
export type GoalFactObservation = Readonly<{
  fact: GoalFact; state: GoalFactState; observedTick: number;
  /** Changes only when this world's answer/evidence changes, not each think. */
  revision: string; reason: AllocationReason; evidence: readonly Evidence[];
  /** Measured amount in the predicate's own units, never route distance/time. */
  quantity?: number;
  /** Only currently observed eligible world entities; never output variables. */
  entityIds?: readonly string[];
  /** Earliest absolute availability. A future met fact cannot make an action
   * ready now; the planner waits or adds an explicit timed achiever. */
  availableTick?: number;
  route?: Readonly<{ distance: number; ticks: number | null; points: readonly Target['point'][] }>;
  goldForecast?: Readonly<{ epoch: number; currentFreeGold: number; goldAtDeadline: number;
    earliestTick: number | null; incomeGoldPerTick: number; factIds: readonly string[];
    source?: Extract<GoalFlowSource, { kind: 'income' }> }>;
  site?: Readonly<{ logicalTarget: Target; buildPoint: Target['point']; buildingId?: string }>;
  interception?: Readonly<{ threatIds: readonly string[]; capableUnitIds: readonly string[]; counterKinds: readonly UnitKind[] }>;
  threats?: Readonly<{ unitIds: readonly string[]; campIds: readonly string[]; requiredForce: number }>;
  /** A shared world rule, e.g. removing these observed threats makes this
   * particular site safe. This is a causal fact proof, not an action recipe. */
  derived?: Readonly<{ allOf: readonly GoalFact[] }>;
}> & (Readonly<{ state: 'pending'; requestId: string; requestedTick: number }>
  | Readonly<{ state: 'met' | 'unmet' }>);
export type GoalFactReader = (fact: GoalFact) => GoalFactObservation;
export type GoalDeclarationContext = Readonly<{ precision: 'coarse' | 'exact'; reservedGold: number;
  allowedUnitIds?: readonly string[]; interruptedUnitIds?: readonly string[]; campIds: readonly string[];
  transportSelections?: readonly Pick<GoalActionDeclaration, 'id' | 'kind' | 'executor'>[];
  prefix?: readonly Readonly<{ action: GoalActionDeclaration; startTick: number; finishTick: number }>[] }>;
export type GoalDeclarationRegeneration = Readonly<{ providerId: string; effect: GoalFact; groundingKey: string;
  context: GoalDeclarationContext; sourceRevision: string;
  dependencies: readonly Readonly<{ fact: GoalFact; revision: string; state: GoalFactState }>[];
  bindings?: Readonly<Record<string, GoalEntityReference>>; finishTick?: number }>;

/** Fact sources must use the same think's shared readers. Unknown geometry,
 * exit, tier or queue work is pending with a stable request, never false. */
export type GoalPlanningContext = Readonly<{
  snapshot: GameSnapshot; situation: DecisionFacts<Situation>; owner: PlayerId; tick: number;
  version: BootstrapAiVersion; readFact: GoalFactReader;
  /** Coarse discovery reads cached observations and optimistic bounds only.
   * Exact native geometry is requested after a plan has been selected. An
   * omitted value retains the existing exact declaration contract. */
  precision?: 'coarse' | 'exact';
  declarationContext?: GoalDeclarationContext;
  declarationSourceRevision?: (action: GoalActionDeclaration) => string;
  /** Absolute search horizon, independent of the observation support window.
   * Explicit fact deadlines and threat windows still take precedence. */
  planThroughTick?: number;
  /** Same shared fact sources; no provider may invent a build/shore point or
   * call native route selection when this port is absent/pending. */
  grounding?: GoalGroundingReader;
  /** The same fact source evaluates explicit planned output references and
   * moved cohorts. It never treats a projected entity as currently available. */
  readProjectedFact?: (fact: GoalFact, projection: Readonly<{
    actions: readonly Readonly<{ action: GoalActionDeclaration; startTick: number; finishTick: number }>[];
    bindings: Readonly<Record<string, GoalEntityReference>>;
  }>) => GoalFactObservation | null;
}>;
export type GoalEstimate<T> = Readonly<{ state: 'met'; value: T; factIds: readonly string[] }>
  | Readonly<{ state: 'pending'; requestIds: readonly string[]; reason: AllocationReason }>
  | Readonly<{ state: 'unmet'; reason: AllocationReason }>;
export type GoalEventTime = 'start' | 'finish' | Readonly<{ offsetTicks: number }>;
export type GoalResource =
  | Readonly<{ kind: 'gold' }>
  | Readonly<{ kind: 'population-room' }>
  | Readonly<{ kind: 'supply-cap' }>
  // Only additive combat-rating is a numeric balance. Camp-force is always
  // the shared whole-group predicate, including its non-linear interactions.
  | Readonly<{ kind: 'force'; at: Target; metric: 'combat-rating'; scope: 'pool' | 'post' }>
  | Readonly<{ kind: 'unit-pool'; unitKind: UnitKind; at: Target }>
  | Readonly<{ kind: 'transport-capacity'; transport: GoalEntityReference; seaId?: SeaId }>
  | Readonly<{ kind: 'transport-capacity'; seaId: SeaId; transport?: GoalEntityReference }>
  /** Payload never conveys command authority. Every moving hull also needs
   * one exclusive entity-control demand, resolved to a real lease when ready. */
  | Readonly<{ kind: 'entity-control'; entity: GoalEntityReference }>
  | Readonly<{ kind: 'production-lane'; producer: GoalEntityReference; lane: string }>;
export type GoalResourceBalance = Readonly<{ resource: GoalResource; quantity: number; asOfTick: number; factIds: readonly string[] }>;
export type GoalFlowSource = Readonly<{ kind: 'event'; id: string }>
  | Readonly<{ kind: 'income'; id: string; segments: readonly Readonly<{ fromTick: number; throughTick: number; ratePerTick: number }>[] }>;
export type GoalResourceFlow = Readonly<{
  resource: GoalResource; delta: number; at: GoalEventTime; factIds: readonly string[];
  /** Positive recurring income is credited once per source/time interval;
   * one-shot rewards once per source event, across differing goal thresholds. */
  source?: GoalFlowSource;
}>;
export type GoalResourceDemand = Readonly<{
  resource: GoalResource | Readonly<{ kind: 'unit'; unitId: string }>;
  quantity: number; from: GoalEventTime; until: GoalEventTime;
}>;
export type GoalFactEffect = Readonly<{ fact: GoalFact; operation: 'establish' | 'invalidate'; at: GoalEventTime }>;
export type GoalActionKind = 'assemble' | 'transport-force' | 'transport-worker' | 'position-transport'
  | 'clear-camp' | 'clear-shore' | 'defend' | 'evacuate'
  | 'train' | 'build' | 'wait-income' | 'destroy-target' | 'hold-position' | 'engage-units';
export type GoalParameter = null | boolean | number | string | readonly GoalParameter[]
  | Readonly<{ [key: string]: GoalParameter }>;
export type GoalExecutorBinding = Readonly<{ executor: string; parameters: Readonly<Record<string, GoalParameter>> }>;
/** Nominal utility loss, separate from cash flows. Losses are realized on
 * completion unless the domain supplies their start/offset occurrence. */
export type GoalActionCost = Readonly<{ code: string; gold: number; factIds: readonly string[];
  at?: GoalResourceFlow['at'] }>;

/** A grounded declaration contains no predecessors, successors or recipe.
 * Gold flows govern solvency; cost terms price it once. A bounty is a positive
 * finish flow, not an ad hoc special-case method. Output references are
 * planned producer slots, never invented world IDs or allocation leases. */
export type GoalActionDeclaration = Readonly<{
  id: string; kind: GoalActionKind; preconditions: readonly GoalFact[];
  regeneration?: GoalDeclarationRegeneration;
  /** Admission evidence covers this action's scheduled completion, rather
   * than its goal's deadline. The scheduler rewrites these fact IDs whenever
   * the action is delayed; persistent protection effects keep their own clock. */
  preconditionWindows?: readonly Readonly<{ factId: string; through: 'finish' }>[];
  /** Coarse declarations are search proposals, never execution authority. */
  precision?: 'coarse' | 'exact';
  effects: readonly GoalFactEffect[]; demands: readonly GoalResourceDemand[];
  /** The original effect/provider, retained across JSON continuation so only
   * a selected proposal needs to rediscover its exact native alternatives. */
  refinementFor?: Readonly<{ providerId: string; effect: GoalFact }>;
  flows: readonly GoalResourceFlow[]; duration: GoalEstimate<number>;
  cost: GoalEstimate<readonly GoalActionCost[]>; successProbability: GoalEstimate<number>;
  executor: GoalExecutorBinding; outputs: readonly string[]; reasons: readonly AllocationReason[];
}>;
/** Providers enumerate grounded achievers for one requested world effect.
 * The planner alone regresses their preconditions and decides their order.
 * For a quantitative predicate, enumerate every matching positive-flow action,
 * including partial contributors. Regression may select several actions to
 * fill one deficit; no individual achiever must cover the entire quantity.
 * Camp-force regresses via additive combat-rating recruitment, then validates
 * the actual whole cohort with the shared camp evaluator after each change. */
export type GoalActionProvider = Readonly<{
  id: string;
  actionsFor: (effect: GoalFact, context: GoalPlanningContext) => readonly GoalActionDeclaration[];
}>;
export type GoalDeferredCandidate = Readonly<{ id: string; requestIds: readonly string[]; reason: AllocationReason }>;
export type GoalCandidates<T> = Readonly<{ state: 'met'; candidates: readonly T[]; factIds: readonly string[];
  /** Known candidates remain usable while other alternatives await facts. */
  deferred?: readonly GoalDeferredCandidate[] }>
  | Readonly<{ state: 'pending'; requestIds: readonly string[]; reason: AllocationReason }>
  | Readonly<{ state: 'unmet'; reason: AllocationReason }>;
export type GoalBuildSite = Readonly<{
  id: string; buildingKind: BuildingKind; logicalTarget: Target; at: Target;
  worker: GoalEntityReference;
  /** No physical origin is invented while transport geometry is unpublished.
   * The pending declaration still exposes its regional worker prerequisite. */
  route: GoalFact | null; walkTicks: GoalEstimate<number>;
  /** Includes native footprint, occupancy and owner/race constraints. */
  preconditions: readonly GoalFact[]; factIds: readonly string[];
}>;
export type GoalProductionOption = Readonly<{
  id: string; buildingKind: BuildingKind; producer: GoalEntityReference; at: Target;
  /** A missing producer is a binding whose building-complete prerequisite
   * regresses through the generic build action, not a fake world entity. */
  preconditions: readonly GoalFact[]; availableTick: number | null; factIds: readonly string[];
}>;
export type GoalTransportOption = Readonly<{
  id: string; seaId: SeaId; from: Target; to: Target; transport: GoalEntityReference; capacity: number;
  /** Entire actual deck/cabin dependency, including passengers outside the
   * selected cohort. They require authority checks, never contribute its force. */
  loadedUnitIds: readonly string[];
  /** Preserve the chosen hull's producer/exit/availability prerequisites. */
  preconditions?: readonly GoalFact[];
  landing: Readonly<{ water: Target['point']; ground: Target['point']; heading: number | null }>;
  crossing: GoalFact; shoreSafe: GoalFact;
  duration: GoalEstimate<number>; factIds: readonly string[];
  cost?: GoalEstimate<readonly GoalActionCost[]>;
  successProbability?: GoalEstimate<number>;
} & (Readonly<{ origin: 'land';
  departure: Readonly<{ water: Target['point']; ground: Target['point']; heading: number | null }>;
  approach: GoalFact;
}> | Readonly<{ origin: 'aboard';
  /** An at-sea origin has no invented pickup shore or land point. */
  departure: Readonly<{ water: Target['point']; heading: number | null; ground?: never }>;
  approach?: GoalFact;
}>)>;
export type GoalTransportRequest = Readonly<{ cohort: readonly GoalEntityReference[] }>;
export type GoalGroundingReader = Readonly<{
  buildSites: (buildingKind: BuildingKind, near: Target) => GoalCandidates<GoalBuildSite>;
  productionOptions: (unitKind: UnitKind, near: Target) => GoalCandidates<GoalProductionOption>;
  /** Missing exact cohort cannot authorize boarding estimates from a stand-in
   * unit. Mass alone does not identify radius, existing cargo or hull binding. */
  transportOptions: (from: Target, to: Target, capacity: number, request?: GoalTransportRequest) => GoalCandidates<GoalTransportOption>;
  combatOptions?: (effect: GoalFact) => GoalCandidates<GoalCombatOption>;
  resolveCohort?: (references: readonly GoalEntityReference[]) => GoalCandidates<GoalCohortMember>;
  /** Common physical origin alternatives, including published native shapes
   * for fungible future pool slots. Domains never infer them from ref names. */
  cohortOptions?: (effect: GoalFact) => GoalCandidates<GoalCohortOption>;
}>;
export type GoalCohortMember = Readonly<{ reference: GoalEntityReference; assessment: Unit }>;
export type GoalCohortOption = Readonly<{
  id: string; members: readonly GoalCohortMember[]; from: Target;
  /** Pool replenishment / transport prerequisites, not an ordering recipe. */
  preconditions: readonly GoalFact[]; availableTick: number | null; factIds: readonly string[];
}>;
export type GoalCombatOption = Readonly<{
  id: string; target: Target; cohort: readonly GoalEntityReference[]; requiredForce: number; byTick: number;
  campId?: string;
  /** Actual source pose/region, distinct from the requested destination post. */
  from?: Target;
  /** On-post prerequisite for a land atom; target retains the actual enemy or
   * world-effect location. March to this point belongs to assemble. */
  post?: Target;
  duration: GoalEstimate<number>; cost: GoalEstimate<readonly GoalActionCost[]>; successProbability: GoalEstimate<number>;
  /** Arrival/activation delay inside a sustained action. Its world effect can
   * become available before its continuing protection lease is released. */
  effectDelayTicks?: GoalEstimate<number>;
  preconditions: readonly GoalFact[]; factIds: readonly string[];
}>;
export type GoalRequest = Readonly<{
  id: string; owner: PlayerId; effects: readonly GoalFact[]; rewardGold: number;
  deadlineTick: number | null; reasons: readonly AllocationReason[];
}>;

export type GoalPlanStatus = 'complete' | 'ready' | 'waiting-facts' | 'blocked' | 'search-pending';
export type GoalPlanFactNode = Readonly<{
  id: string; observation: GoalFactObservation; producerActionIds: readonly string[];
}>;
export type GoalActionNode = Readonly<{
  id: string; declaration: GoalActionDeclaration; prerequisiteFactIds: readonly string[];
  dependsOnActionIds: readonly string[]; startTick: number | null; finishTick: number | null;
  state: 'ready' | 'waiting-facts' | 'waiting-actions' | 'waiting-time' | 'blocked' | 'world-effects-met';
  /** Optional binding to the existing allocator/command authority. */
  allocation?: Readonly<{ objectiveId: string; methodId: string; actionId: string; generation: number }>;
  refinement?: Readonly<{
    state: 'pending' | 'known' | 'invalid'; coarse: GoalActionDeclaration; exact?: GoalActionDeclaration;
    delta?: Readonly<{ durationTicks: number; costGold: number; successProbability: number }>;
    reason: AllocationReason;
  }>;
  reasons: readonly AllocationReason[];
}>;
export type GoalPlanEdge = Readonly<{ from: string; to: string; kind: 'requires' | 'establishes' | 'resource-before' }>;
export type GoalSubgoal = Readonly<{
  id: string; factId: string; parentGoalId: string; requestedByActionIds: readonly string[];
  state: GoalFactState; chosenActionId: string | null; alternativeIds: readonly string[];
  chosenActionIds?: readonly string[];
}>;
export type GoalAlternative = Readonly<{
  id: string; factId: string; actionId: string; status: 'chosen' | 'rejected' | 'pending';
  /** New planner traces always include this, even when the rejected action
   * is outside the selected graph. Optional for older trace readers only. */
  declaration?: GoalActionDeclaration;
  costGold: number | null; finishTick: number | null; reason: AllocationReason;
}>;
export type GoalResourceEvent = Readonly<{
  actionId: string; tick: number; resource: GoalResource; before: number; delta: number; after: number;
}>;
export type GoalSearchLimits = Readonly<{ maxDepth: number; maxExpansions: number; maxPlans: number }>;
export type GoalPlan = Readonly<{
  id: string; goal: GoalRequest; status: GoalPlanStatus; observedTick: number;
  facts: readonly GoalPlanFactNode[]; actions: readonly GoalActionNode[]; edges: readonly GoalPlanEdge[];
  capacityPressure?: readonly GoalCapacityPressure[];
  deferredCandidates?: readonly (GoalDeferredCandidate & Readonly<{ factId: string }>)[];
  subgoals: readonly GoalSubgoal[]; alternatives: readonly GoalAlternative[]; readyActionIds: readonly string[];
  resourceTimeline: readonly GoalResourceEvent[];
  costGold: number | null; successProbability: number | null; valueGold: number | null; completedTick: number | null;
  search: Readonly<{ expansions: number; depth: number; work: number; limitReason: string | null }>;
  reasons: readonly AllocationReason[];
}>;
export type GoalPlanCacheEntry = Readonly<{
  sourceRevision?: string;
  goalKey: string; declarationRevision: string;
  dependencies: readonly Readonly<{ factId: string; revision: string; state: GoalFactState }>[];
  plan: GoalPlan;
  /** Finite declarative frontier only; no callbacks, snapshots or task state. */
  continuation?: import('./goal-search-state').GoalSearchMemory;
}>;
export type GoalPlannerCache = Readonly<import('./cache-payload').CachePayload<GoalPlanCacheEntry> & { version: 1; owner: PlayerId; declarationRevision?: string; capacity?: import('./bounded-cache').CacheCapacity; truncated?: true }>;
export type GoalCapacityPressure = import('./bounded-cache').CachePressure;
export type GoalPlannerInput = Readonly<{
  searchRetention?: 'selected-and-opponent';
  /** Exact quotation sources for the retained incumbent and its opponents.
   * Cached world observations are reread, never restored as current proof. */
  cacheSourceRevision?: (plan: GoalPlan) => string;
  campModelUsage?: () => Readonly<import('./goal-camp-default-model').GoalCampModelUsage>;
  context: GoalPlanningContext; goals: readonly GoalRequest[]; providers: readonly GoalActionProvider[];
  /** Finish publication leases against this chosen graph, not historical alternatives. */
  retainFactRequests?: (plans: readonly GoalPlan[]) => void;
  /** Exact quotes from already-published facts may re-enter this same work ledger. */
  refinementRevision?: () => string;
  /** Regress a coarse prerequisite from the selected existing-member moves.
   * The view shares this think's readers and never creates a Situation/query. */
  contextForPrefix?: (actions: readonly Readonly<{ action: GoalActionDeclaration; startTick: number; finishTick: number }>[]) => GoalPlanningContext;
  initialBalances: readonly GoalResourceBalance[]; limits: GoalSearchLimits;
  /** Ownership changes the free-capital view, never the underlying world.
   * Each goal can use its own earmark; other goals still see it reserved. */
  contextForGoal?: (goal: GoalRequest) => Readonly<{
    context: GoalPlanningContext; initialBalances: readonly GoalResourceBalance[];
    contextForPrefix?: NonNullable<GoalPlannerInput['contextForPrefix']>;
  }>;
  declarationRevision: string; previous?: GoalPlannerCache;
  /** Same ledger, distinct finite continuation for physical resource exclusions. */
  searchScope?: string;
  /** The owner-think queue, not a second planning allowance. Search expansion
   * registers finite work here and returns search-pending when deferred. */
  work: FactWorkQueue;
  capacityPressure?: () => readonly GoalCapacityPressure[];
  /** Refine only a selected plan's ready atoms and their next prerequisites.
   * The returned graph retains coarse/exact evidence and grants no coarse atom. */
  refineSelected?: (plan: GoalPlan) => GoalPlan;
}>;
export type GoalPlannerOutput = Readonly<{
  plans: readonly GoalPlan[]; cache: GoalPlannerCache;
  campModelUsage?: Readonly<import('./goal-camp-default-model').GoalCampModelUsage>;
  readyActions: readonly Readonly<{ goalId: string; planId: string; action: GoalActionNode }>[];
}>;
