import type { AssemblyDelayLossUpperBound, AssemblyDisplacementQuote } from './types';
import type { GameCommand, GameSnapshot, PlayerId, TrainableUnitKind, Unit, UnitOrder } from '../../shared/types';
import type { FixedVoyage, FixedVoyageLoading } from './arrivals';
import type { AssemblyFactsReader } from './assembly-facts';
import type { VoyageRiskStages } from './voyage-risk';
import type { ExecutorReason } from '../executor-reasons';
import type { DecisionFacts } from './decision';
import type { AssignmentId, AssignmentStage, BudgetEntry, Effect, LandId, Location, Method, MethodId, Objective,
  ObjectiveId, Precondition, ResourceDemand, Situation, Subgoal, Target, UnitRole, Utility, CrossingEta, ValuationContext,
  ValuationQuotation, ValuationWindow, ImportedLossUpperBound, Arrival, ProductionUse } from './types';

/** Formal control contracts. No executor registration or behavior is enabled by these types. */
export type ActionId = string;
export type AllocationEventId = string;
export type AllocationLeaseId = string;
/** A hull, worker and combatant all use the same physical-unit key. */
export type ExclusiveResourceKey = `unit:${string}` | `queue:${string}` | `research:${string}`;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type ExecutionState = Readonly<Record<string, JsonValue>>;
/** Generation changes on replacement/restart, not on each think or budget refresh. */
export type ActionToken = Readonly<{ actionId: ActionId; generation: number }>;
/** Production references remain symbolic until the exact foundation result is
 * observed. An already-paid native job is adopted, never submitted twice. */
export type ProductionBinding = Readonly<{
  producer: Readonly<{ kind: 'existing'; buildingId: string } | { kind: 'action-result'; actionId: ActionId }>;
  unitKind: TrainableUnitKind;
  request: Readonly<{ kind: 'submit'; spendId: string } | { kind: 'adopt-paid'; jobId: string | null;
    /** Baseline in the actual native training queue; nullable job IDs are not invented IDs. */
    queueIndex: number; observedTick: number; remainingTicks: number }>;
}>;
export type ActionIntent =
  | import('./goal-execution-types').GoalExecutableIntent
  | Readonly<{ kind: 'clear-camp'; memberIds: readonly string[] }>
  | Readonly<{ kind: 'assemble-force'; campTarget: Target; requiredForce: number;
      posts: readonly Readonly<{ id: string; target: Target; unitIds: readonly string[] }>[] }>
  | Readonly<{ kind: Exclude<Subgoal['kind'], 'clear-camp' | 'assemble-force'> | 'defend-site' | 'recall' | 'wait-in-cover' | 'load' | 'sail' | 'unload'
      | 'attack-site' | 'contest-route' | 'counter-harass' | 'recover-site' }>;
export type AllocationReason = Readonly<{ code: string; factIds: readonly string[];
  values: Readonly<Record<string, string | number | boolean | null>> }>;
export type AllocationUtility = Omit<Utility, 'benefit' | 'cost' | 'evidence'> & Readonly<{
  benefit: readonly Omit<Utility['benefit'][number], 'explanation'>[];
  cost: readonly Omit<Utility['cost'][number], 'explanation'>[];
}>;
export type AllocationPrecondition = Omit<Precondition, 'reason'> & Readonly<{ reason: AllocationReason }>;
export type AllocationLocation = Exclude<Location, { kind: 'unknown' }>
  | Readonly<{ kind: 'unknown'; point: Location['point']; reason: AllocationReason }>;

/** Absolute simulation ticks. Unknown routes never use zero or Infinity as a sentinel. */
export type AllocationEta =
  | Readonly<{ status: 'known'; forecastTick: number; arrivalTick: number }>
  | Readonly<{ status: 'conditional' | 'unknown' | 'unreachable'; forecastTick: number;
    arrivalTick: number | null; reason: AllocationReason }>;
export type ResourceLease = Readonly<{
  id: AllocationLeaseId;
  resourceKey: ExclusiveResourceKey;
  objectiveId: ObjectiveId;
  methodId: MethodId;
  action: ActionToken;
  sinceTick: number;
  minimumStayUntilTick: number;
  /** A migrated executor is authoritative; an imported incumbent remains explicitly identified. */
  origin: 'allocator' | 'imported-task';
  incumbentTask: Readonly<{ source: string; taskId: string }> | null;
}>;
export type FormalAssignment = Readonly<{
  authority: 'committed';
  id: AssignmentId;
  leaseId: AllocationLeaseId;
  unitId: string;
  role: UnitRole;
  objectiveId: ObjectiveId;
  methodId: MethodId;
  action: ActionToken;
  target: Target;
  stage: AssignmentStage;
  eta: AllocationEta;
  lastLocation: AllocationLocation;
  interruption: Readonly<{ kind: 'worker-safety' | 'shell-evasion' | 'retreat' | 'healing';
    executor: string; sinceTick: number; resumeStage: AssignmentStage; vacancyId: string }> | null;
}>;
export type AllocationVacancy = Readonly<{
  id: string;
  objectiveId: ObjectiveId;
  action: ActionToken;
  assignmentId: AssignmentId;
  sinceTick: number;
  demand: ResourceDemand;
  replacementAssignmentIds: readonly AssignmentId[];
  reason: AllocationReason;
}>;

/** A spend is semantic capital (e.g. one hall at one mine), not one demand occurrence.
 * wait-income and build-hall reference the same spendId; alternative methods do not reserve twice. */
export type AllocationBudget = Readonly<{
  id: string;
  spendId: string;
  objectiveId: ObjectiveId;
  methodId: MethodId;
  action: ActionToken;
  amountGold: number;
  paidGold: number;
  /** An admitted goal chain earmarks actual cash toward this later payment.
   * The target is not cash; amountGold remains the funded/paid amount. */
  plannedGold?: number;
  expectedPaymentTick?: number;
  /** Goal batches can pay several distinct native jobs from one reservation.
   * Identity makes equal-sized payments idempotent without losing later jobs. */
  nativePayments?: readonly Readonly<{ kind: 'production' | 'foundation'; commandId: string;
    entityId: string; amountGold: number; observedTick: number }>[];
  state: 'reserved' | 'spent' | 'released';
  sinceTick: number;
  releasedTick: number | null;
  /** Cash admission is separate from utility; these costs are already included in that quote. */
  includedUtilityTermCodes: readonly string[];
  externalReservationIds: readonly string[];
}>;
/** Candidate-side capital registry. Action spendIds reference these entries;
 * descriptive gold demands never create an independent reservation. */
export type PlannedAllocationSpend = Readonly<{
  spendId: string;
  amountGold: number;
  expectedPaymentTick?: number;
  includedUtilityTermCodes: readonly string[];
  externalReservationIds: readonly string[];
}>;
/** Initial unmet demand is distinct from a vacancy left by an interrupted assignee. */
export type AllocationUnmetDemand = Readonly<{
  id: string;
  objectiveId: ObjectiveId;
  methodId: MethodId | null;
  action: ActionToken | null;
  demand: ResourceDemand;
  reason: AllocationReason;
}>;
export type ForceQuotation = Readonly<{
  metric: 'field-strength' | 'camp-force';
  target: Target;
  onStationUnitIds: readonly string[];
  enRouteUnitIds: readonly string[];
  unavailableUnitIds: readonly string[];
  onStationForce: number;
  /** Target-specific cohort evaluation, not the sum of SituationUnit.strength for a camp. */
  effectiveForce: number;
  discountedEnRouteForce: number;
  requiredForce: number;
  evaluationUntilTick: number;
  unknownUnitIds: readonly string[];
}>;
export type VoyageAllocation = Readonly<{
  id: string;
  objectiveId: ObjectiveId;
  action: ActionToken;
  shipAssignmentId: AssignmentId;
  crewAssignmentIds: readonly AssignmentId[];
  /** Actual passengers may differ from the planned boarding manifest. */
  passengerIds: readonly string[];
  departure: Target;
  destination: Target;
  /** Verified land-side points of this same crossing, never a fresh projection
   * of the water point on an executor's next think. */
  departureGround: Target & Readonly<{ landId: LandId }>;
  landingGround: Target & Readonly<{ landId: LandId }>;
  phase: 'loading' | 'sailing' | 'unloading' | 'return';
  startedTick: number;
  expectedFreeTick: number | null;
  /** Absolute embarkation completion; null/absent when this stage is unquoted. */
  expectedLoadedTick?: number | null;
  /** Source think of the loading forecast, retained with the prediction. */
  loadingForecastTick?: number | null;
  decision: 'continue' | 'stop-loading' | 'return' | 'redirect';
}>;
/** Candidate geometry and manifest chosen by materialize. The allocator may
 * grant this exact plan; it must not reselect a shore or invent a passenger.
 * Production references become physical hulls only after observed birth. */
export type PlannedVoyage = Readonly<{
  id: string;
  actionId: ActionId;
  ship: Readonly<{ kind: 'existing'; unitId: string }> | Readonly<{ kind: 'production'; actionId: ActionId }>;
  unitIds: readonly string[];
  departure: Target;
  destination: Target;
  departureGround: Target & Readonly<{ landId: LandId }>;
  landingGround: Target & Readonly<{ landId: LandId }>;
  crossing: CrossingEta;
  required: boolean;
}>;
export type AllocationValuationBasis = Readonly<{ kind: 'proven-lower-bound';
  probabilityLower: number; probabilityUpper: number; unresolvedProbability: number }>;
export type AllocationDecisionCounts = Readonly<{ lowerBoundSelections: number; lowerBoundInitialSelections: number; assemblyValueUnknownComparisons?: number }>;
export type ObjectiveAllocation = Readonly<{
  objectiveId: ObjectiveId;
  methodId: MethodId;
  target: Target;
  effectKeys: readonly string[];
  status: 'active' | 'paused' | 'blocked' | 'complete' | 'failed' | 'abandoned';
  actionIds: readonly ActionId[];
  assignmentIds: readonly AssignmentId[];
  budgetIds: readonly string[];
  sinceTick: number;
  minimumStayUntilTick: number;
  challengerId: ObjectiveId | null;
  challengerThinks: number;
  /** Future value only; completed benefits and blocked potential scores cannot be displaced loss. */
  committedUtilityGold: number | null;
  valuationBasis?: AllocationValuationBasis;
  force: ForceQuotation | null;
}>;
export type ExecutionAction = Readonly<{
  token: ActionToken;
  objectiveId: ObjectiveId;
  methodId: MethodId;
  executor: string;
  intent: ActionIntent;
  production?: ProductionBinding;
  target: Target;
  dependsOn: readonly ActionId[];
  /** Terminal handoff belongs here, never in departure admission. */
  completionEffects: readonly Effect[];
  status: 'waiting' | 'ready' | 'active' | 'blocked' | 'complete' | 'failed' | 'abandoned';
  phase: string;
  sinceTick: number;
  lastProgressTick: number;
  /** One action's own progress only; no shared general/hold/miningDefense or raw world graph. */
  state: ExecutionState;
}>;
export type IssuedActionOrder = Readonly<{
  commandId: string;
  action: ActionToken;
  executor: string;
  purpose: 'task' | 'life-saving';
  unitId: string;
  acceptedTick: number;
  observedTick: number | null;
  /** Captured from the real world, not reconstructed from a former intention. */
  observedOrder: Readonly<UnitOrder> | null;
}>;
export type IssuedActionCommand = Readonly<{
  id: string;
  action: ActionToken;
  executor: string;
  purpose: IssuedActionOrder['purpose'];
  acceptedTick: number;
  command: GameCommand;
  /** Minimal admission-time baseline for proving a later world payment. */
  worldBefore?: Readonly<{ kind: 'production'; buildingId: string;
    jobs: readonly Readonly<{ id: string | null; unitKind: TrainableUnitKind | null }>[];
    /** Actual mover-region quantity baseline; never individual birth IDs. */
    pool?: Readonly<{ key: string; at: Target; quantity: number; creditFloor: number }> }>
    | Readonly<{ kind: 'construction'; buildingIds: readonly string[] }>;
}>;
/** An accepted command from a real old producer branch, before adoption. This
 * is provenance, not a lease or an inferred former intention. Bulk commands are
 * projected to this unit only, retaining the shared actual command id. */
export type IncumbentOrderReceipt = Readonly<{
  unitId: string;
  commandId: string;
  executor: string;
  task: Readonly<{ source: string; taskId: string }>;
  acceptedTick: number;
  command: GameCommand;
  observedTick: number | null;
  observedOrder: Readonly<UnitOrder> | null;
}>;
export type CandidateSwitchRecord = Readonly<{ revision: number; tick: number; fromTaskId: string;
  toObjectiveId: ObjectiveId; diagnosedRevision: number | null }>;
export type AllocationPayment = Readonly<{
  budgetId: string;
  amountGold: number;
  proof: Readonly<{ kind: 'production'; buildingId: string; jobId: string | null;
    acceptedCommandId: string; unitKind: TrainableUnitKind; queueIndex: number }>
    | Readonly<{ kind: 'foundation'; buildingId: string; acceptedCommandId: string }>;
}>;

export type SafetyObstacle =
  | Readonly<{ kind: 'camp'; memberIds: readonly string[]; point: Target }>
  | Readonly<{ kind: 'enemy-tower'; towerId: string; point: Target }>
  | Readonly<{ kind: 'route-segment'; from: Target; to: Target; reason: AllocationReason }>
  | Readonly<{ kind: 'landing'; point: Target; reason: AllocationReason }>;
export type SafetyBlockedQuote = Readonly<{
  id: string;
  parent: ActionToken;
  objectiveId: ObjectiveId;
  methodId: MethodId;
  interruptedCommandId: string;
  interruptedExecutor: string;
  interruptedTick: number;
  interruptedUnitId: string;
  actualInterruptedOrder: Readonly<UnitOrder>;
  heldLeaseIds: readonly AllocationLeaseId[];
  unpaidBudgetIds: readonly string[];
  obstacles: readonly SafetyObstacle[];
  missingPreconditions: readonly AllocationPrecondition[];
  potentialUtility: AllocationUtility | null;
  /** Each alternative is quoted independently; unknown is explicit. */
  alternatives: readonly Readonly<{ kind: 'continue' | 'reassign' | 'clear-obstacle' | 'abandon';
    methodId: MethodId | null; estimatedGold: number | null; estimatedTicks: number | null;
    includedSpendIds: readonly string[]; reason: AllocationReason }>[];
  reason: ExecutorReason;
}>;
export type PreemptionQuotation = Readonly<{
  fromObjectiveId: ObjectiveId;
  toObjectiveId: ObjectiveId;
  resourceKeys: readonly ExclusiveResourceKey[];
  /** null blocks stealing; an unpriced incumbent does not cost zero. */
  marginalBenefitGold: number | null;
  displacedLossGold: number | null;
  displacedLoss?: Readonly<{ kind: 'remaining-utility' } | { kind: 'upper-bound'; bound: ImportedLossUpperBound }
    | { kind: 'assembly-delay-upper-bound'; bound: AssemblyDelayLossUpperBound }>;
  switchingCostGold: number | null;
  reason: AllocationReason;
}>;
type EventHeader = Readonly<{ id: AllocationEventId; tick: number; revision: number; objectiveId: ObjectiveId;
  methodId: MethodId; action: ActionToken; reason: AllocationReason }>;
export type AllocationEvent = EventHeader & (
  | Readonly<{ kind: 'valuation-bound-selected'; basis: AllocationValuationBasis; scoreGold: number; renewal: boolean }>
  | Readonly<{ kind: 'incumbent-adopted'; leaseIds: readonly AllocationLeaseId[] }>
  | Readonly<{ kind: 'preempted'; quotation: PreemptionQuotation; handoff: 'pending' | 'shrink' | 'pause' | 'fail' }>
  | Readonly<{ kind: 'candidate-reassigned'; fromTask: Readonly<{ source: string; taskId: string }>;
    unitIds: readonly string[]; repeatedUnitIds: readonly string[] }>
  | Readonly<{ kind: 'interrupted' | 'resumed'; assignmentId: AssignmentId; vacancyId: string }>
  | Readonly<{ kind: 'vacancy-filled'; vacancyId: string; assignmentIds: readonly AssignmentId[] }>
  | Readonly<{ kind: 'assignment-stage'; assignmentId: AssignmentId; from: AssignmentStage; to: AssignmentStage }>
  | Readonly<{ kind: 'lease-transferred'; fromObjectiveId: ObjectiveId; toObjectiveId: ObjectiveId;
    assignmentIds: readonly AssignmentId[]; leaseIds: readonly AllocationLeaseId[] }>
  | Readonly<{ kind: 'action-blocked'; quoteId: string }>
  | Readonly<{ kind: 'parent-invalidated'; releasedLeaseIds: readonly AllocationLeaseId[]; releasedBudgetIds: readonly string[] }>
  | Readonly<{ kind: 'voyage-reevaluated'; voyageId: string; decision: VoyageAllocation['decision'] }>
  | Readonly<{ kind: 'action-finished'; outcome: 'complete' | 'failed' | 'abandoned' }>
  | Readonly<{ kind: 'progress'; progress: 'loaded' | 'sailed' | 'unloaded' | 'camp-cleared' | 'hall-founded'
      | 'hall-complete' | 'garrison-arrived' | 'mining-started'; unitIds: readonly string[]; entityIds: readonly string[] }>
);

/** The complete save/fork authority, separate from strategy.observation.
 * Records contain JSON data only; counters and pending feedback survive restart. */
export type StrategyAllocationMemory = Readonly<{
  version: 1;
  owner: PlayerId;
  evaluatedTick: number;
  revision: number;
  nextActionGeneration: number;
  nextEventSequence: number;
  /** Immutable goal definitions live once here; control records use short
   * version references. This data counts toward the same authority byte cap. */
  goalReferences?: import('./goal-versioned-references').GoalReferenceMemory;
  goalIdentityVersion?: 1;
  decisionCounts?: AllocationDecisionCounts;
  goalTraining?: import('./goal-training-ledger').GoalTrainingMemory;
  objectives: Readonly<Record<ObjectiveId, ObjectiveAllocation>>;
  /** Concrete, numerical plans survive forks and hull birth. An active voyage
   * must not lose its manifest because a later query starts aboard the ship. */
  methods: Readonly<Record<MethodId, ExecutableMethod>>;
  executions: Readonly<Record<ActionId, ExecutionAction>>;
  leases: Readonly<Record<ExclusiveResourceKey, ResourceLease>>;
  assignments: Readonly<Record<AssignmentId, FormalAssignment>>;
  budgets: Readonly<Record<string, AllocationBudget>>;
  voyages: Readonly<Record<string, VoyageAllocation>>;
  vacancies: Readonly<Record<string, AllocationVacancy>>;
  issuedOrders: Readonly<Record<string, IssuedActionOrder>>;
  /** Commands are stored once by id, retained only while an order or blocked parent references them. */
  issuedCommands: Readonly<Record<string, IssuedActionCommand>>;
  incumbentOrders: Readonly<Record<string, IncumbentOrderReceipt>>;
  candidateSwitches: Readonly<Record<string, CandidateSwitchRecord>>;
  blocked: Readonly<Record<string, SafetyBlockedQuote>>;
  unmet: readonly AllocationUnmetDemand[];
  /** Bounded recent journal + unacknowledged handoffs; never a previous-memory chain. */
  events: readonly AllocationEvent[];
}>;
export type ActionGrant = Readonly<{
  revision: number;
  action: ActionToken;
  objectiveId: ObjectiveId;
  methodId: MethodId;
  leases: readonly ResourceLease[];
  assignments: readonly FormalAssignment[];
  budgets: readonly AllocationBudget[];
  voyages: readonly VoyageAllocation[];
  orders: readonly IssuedActionOrder[];
  commands: readonly IssuedActionCommand[];
  /** Only these actual handoffs may override an old board-order placeholder. */
  orderOverrides: readonly Readonly<{ unitId: string; preemptionEventId: AllocationEventId; previousCommandId: string | null }>[];
}>;
export type ExecutorInput = Readonly<{
  goalReferences?: import('./goal-versioned-references').GoalReferenceMemory;
  snapshot: GameSnapshot;
  owner: PlayerId;
  objective: DecisionFacts<Objective>;
  method: DecisionFacts<Method>;
  execution: ExecutionAction;
  grant: ActionGrant;
  events: readonly AllocationEvent[];
  /** The same owner-think source, including actual free cash after reserved
   * budgets. This callback never enters serialized execution state. */
  goalFacts?: import('./goal-planner-types').GoalFactReader;
  /** Same-epoch central job / aggregate-pool accounting, without birth IDs. */
  goalTraining?: import('./goal-execution-types').GoalTrainingReader;
}>;
export type ExecutorFeedback = Readonly<{
  action: ActionToken;
  allocationRevision: number;
  state: ExecutionState;
  phase: string;
  status: ExecutionAction['status'];
  /** Proposals until the common gateway admits them; acceptance alone is not world progress. */
  commands: readonly Readonly<{ command: GameCommand; purpose: IssuedActionOrder['purpose'] }>[];
  /** Actual loading, motion, unloading and completion only. */
  progress: readonly Readonly<{ kind: Extract<AllocationEvent, { kind: 'progress' }>['progress'];
    unitIds: readonly string[]; entityIds: readonly string[]; basis: 'observed-world' }>[];
  reasons: readonly ExecutorReason[];
  blocked: readonly SafetyBlockedQuote[];
  /** A receipt is checked against the native queue/foundation and the captured
   * pre-command baseline. Command admission alone is never a payment. */
  payments?: readonly AllocationPayment[];
  /** Declarative output slots are not bound until the common lifecycle
   * validates these proposals against actual native world evidence. */
  goalOutputs?: readonly import('./goal-execution-types').GoalOutputReceipt[];
  handoffs: readonly Readonly<{ eventId: AllocationEventId; disposition: 'shrink' | 'pause' | 'fail' }>[];
}>;
export type ExecutableMethod = DecisionFacts<Method> & Readonly<{
  providerId: string;
  /** A completed gathering coordinator is a retained prerequisite, not the
   * conquest's final effect. Existing methods omit this and execute normally. */
  stage?: 'assembly' | 'execution' | 'goal-plan';
  /** Exact current ready/active bundle declared by goal regression. The
   * allocator must not recruit prefix members or implicit auxiliary units. */
  goalBundle?: Readonly<{ planId: string; unitIds: readonly string[] }>;
  /** Stable preference within this objective, not a global defense/island priority. */
  preference: number;
  spends: readonly PlannedAllocationSpend[];
  voyagePlans?: readonly PlannedVoyage[];
  actions: readonly Readonly<{ id: ActionId; executor: string; intent: ActionIntent; production?: ProductionBinding; target: Target; dependsOn: readonly ActionId[];
    demands: readonly ResourceDemand[]; spendIds: readonly string[]; completionEffects: readonly Effect[];
    /** Materialized bundle subset, including separate sources' assembly groups.
     * Omission is an unresolved skeleton, never permission to select globally. */
    unitIds?: readonly string[] }>[];
}>;
type MethodQuoteFacts = Readonly<{
  valuationBasis?: AllocationValuationBasis;
  methodId: MethodId;
  force: ForceQuotation | null;
  reason: AllocationReason;
  valuation?: ValuationQuotation;
  assumptions?: readonly AllocationReason[];
}>;
export type MethodAllocationQuote = MethodQuoteFacts & (
  | Readonly<{ status: 'feasible'; utility: AllocationUtility; potentialUtility: null; missingPreconditions: readonly [] }>
  | Readonly<{ status: 'blocked'; utility: null; potentialUtility: AllocationUtility | null;
    missingPreconditions: readonly AllocationPrecondition[] }>
);
export interface StrategyExecutor {
  readonly id: string;
  /** May inspect the world, but selects/commands only granted units, ships and budget. */
  execute(input: ExecutorInput): ExecutorFeedback;
}
export type AllocationMethodQuoteInput = Readonly<{
  snapshot: GameSnapshot;
  situation: DecisionFacts<Situation>;
  objective: DecisionFacts<Objective>;
  method: ExecutableMethod;
  unitIds: readonly string[];
  budgets: readonly AllocationBudget[];
  /** Explicit counterfactual pool from current authority and native orders.
   * Idle proposed reservations remain visible commitments, but are not leases. */
  responseEligibleUnitIds?: readonly string[];
  /** Current authority interruptions. A patient at the post cannot satisfy
   * departure readiness while its recovery still owns the unit's movement. */
  interruptedUnitIds?: readonly string[];
  /** Real current action records, including observed production results. The
   * caller supplies these on each transaction; providers keep no hidden history. */
  executions: readonly ExecutionAction[];
  /** One deterministic batch, keyed by materialized PlannedVoyage.id; quotes
   * never advance observation memory themselves. Missing risk stays unknown. */
  voyageRisks?: ReadonlyMap<string, VoyageRiskStages>;
  /** Same transaction's shared query, bound to the physical hull and original
   * shores. Providers never construct an independent route evaluator. */
  fixedVoyageArrival?: (unit: Unit, target: Target, voyage: FixedVoyage) => DecisionFacts<Arrival>;
  assemblyFacts?: AssemblyFactsReader;
  valuation?: ValuationContext;
}>;
export interface AllocationMethodProvider {
  readonly id: string;
  buildMethods(input: Readonly<{ snapshot: GameSnapshot; situation: DecisionFacts<Situation>; objective: DecisionFacts<Objective>;
    previous: ObjectiveAllocation | null; executions: readonly ExecutionAction[];
    blocked: readonly SafetyBlockedQuote[] }>): readonly ExecutableMethod[];
  /** Specialize a skeleton using the supplied candidate bundle. Hull count,
   * capital and dependencies are re-quoted before any lease changes hands. */
  materialize?(input: AllocationMethodQuoteInput): ExecutableMethod;
  /** Reprice this supplied bundle, including target-specific camp force; never add hidden members. */
  quote(input: AllocationMethodQuoteInput): MethodAllocationQuote;
}
export type StrategyAllocationInput = Readonly<{
  snapshot: GameSnapshot;
  situation: DecisionFacts<Situation>;
  objectives: readonly DecisionFacts<Objective>[];
  methods: readonly ExecutableMethod[];
  providers: readonly AllocationMethodProvider[];
  previous: StrategyAllocationMemory | null;
  /** Same-think before/after supply and cash-flow proof for a committed
   * assembly. A finite whole-value cap is explicit, never a fake exact zero. */
  assemblyDelayLossUpperBound?: (request: Readonly<{ objectiveId: string; methodId: string;
    unitIds: readonly string[]; remainingUnitIds: readonly string[]; window: ValuationWindow;
    unavailableProduction: readonly ProductionUse[] }>) => AssemblyDisplacementQuote;

  /** Already published once for this think; provider quotes are read-only. */
  voyageRisks?: ReadonlyMap<string, VoyageRiskStages>;
  /** Framework batch after candidate materialization, before final gross/net
   * pricing. Called once; providers cannot advance sampling themselves. */
  prepareVoyageRisks?: (methods: readonly ExecutableMethod[], quotes: readonly MethodAllocationQuote[]) => ReadonlyMap<string, VoyageRiskStages>;
  fixedVoyageArrival?: AllocationMethodQuoteInput['fixedVoyageArrival'];
  assemblyFacts?: AssemblyFactsReader;
  /** Same query's loading stage, independent of unpublished later legs. */
  fixedVoyageLoading?: (unit: Unit, voyage: FixedVoyage) => FixedVoyageLoading;
  /** Verified optimistic target envelope only for imported-task leases. */
  importedUpperBound?: (objectiveId: string, window: ValuationWindow) => ImportedLossUpperBound | null;
  /** Receipt-backed imported progress towards the requester's same terminal
   * effect. This removes displaced-plan value, never the physical handoff. */
  continuesImported?: (fromObjectiveId: string, toObjectiveId: string) => boolean;
  /** Optional observation of the exact materialized request, never a second
   * provider evaluation. The receiver cannot participate in admission. */
  observeCandidate?: (request: Readonly<{ objectiveId: string; method: ExecutableMethod;
    unitIds: readonly string[]; phase: 'gross' | 'net'; quote: MethodAllocationQuote;
    voyageRisks?: ReadonlyMap<string, VoyageRiskStages> }>) => void;
  /** Current, explicit switching quote. Missing/unknown prices cannot authorize
   * taking an executed incumbent's resource. */
  switchingCost?: (request: Readonly<{ fromObjectiveId: string; toObjectiveId: string;
    resourceKeys: readonly ExclusiveResourceKey[] }>) => number | null;
  /** Imported producers must acknowledge cleanup before resource ownership
   * changes. The caller operates on its isolated transaction memory. */
  handoffImported?: (requests: readonly Readonly<{ leases: readonly ResourceLease[];
    resourceKeys: readonly ExclusiveResourceKey[]; eventId: string }>[]) =>
    readonly Readonly<{ eventId: string; disposition: 'shrink' | 'pause' | 'fail' }>[] | null;
}>;
export type StrategyAllocationDecision = Readonly<{
  memory: StrategyAllocationMemory;
  grants: readonly ActionGrant[];
  events: readonly AllocationEvent[];
  unmet: readonly AllocationUnmetDemand[];
}>;
export interface StrategyAllocator {
  /** Same snapshot + restored full AI memory must reproduce the same transaction. */
  allocate(input: StrategyAllocationInput): StrategyAllocationDecision;
}
export type CommandAdmission = Readonly<{
  commandId: string;
  source: 'script' | 'executor';
  executor: string;
  action: ActionToken | null;
  allocationRevision: number | null;
  purpose: IssuedActionOrder['purpose'];
  command: GameCommand;
}> & (
  | Readonly<{ status: 'accepted'; admittedTick: number; queuedTick: number | null }>
  | Readonly<{ status: 'rejected'; reason: ExecutorReason }>
);
export type StrategyAllocationTrace = Readonly<{
  goalReferences?: import('./goal-versioned-references').GoalReferenceMemory;
  revision: number;
  decisionCounts?: AllocationDecisionCounts;
  objectives: readonly ObjectiveAllocation[];
  assignments: readonly FormalAssignment[];
  executions: readonly ExecutionAction[];
  budget: readonly AllocationBudget[];
  voyages: readonly VoyageAllocation[];
  vacancies: readonly AllocationVacancy[];
  blocked: readonly SafetyBlockedQuote[];
  unmet: readonly AllocationUnmetDemand[];
  events: readonly AllocationEvent[];
  /** Current transaction, reconstructed from input; not a retained trace chain. */
  commandAdmissions?: readonly CommandAdmission[];
  /** Compatibility projection, not another pool of spendable gold. */
  budgetProjection: readonly BudgetEntry[];
}>;
