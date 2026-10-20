import type { GameCommand, GameSnapshot, PlayerId, TrainableUnitKind, UnitOrder } from '../../shared/types';
import type { ExecutorReason } from '../executor-reasons';
import type { DecisionFacts } from './decision';
import type { AssignmentId, AssignmentStage, BudgetEntry, Effect, LandId, Location, Method, MethodId, Objective,
  ObjectiveId, Precondition, ResourceDemand, Situation, Subgoal, Target, UnitRole, Utility, CrossingEta, ValuationContext, ValuationQuotation } from './types';

/** Formal control contracts. No executor registration or behavior is enabled by these types. */
export type ActionId = string;
export type AllocationEventId = string;
export type AllocationLeaseId = string;
/** A hull, worker and combatant all use the same physical-unit key. */
export type ExclusiveResourceKey = `unit:${string}` | `queue:${string}`;
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type ExecutionState = Readonly<Record<string, JsonValue>>;
/** Generation changes on replacement/restart, not on each think or budget refresh. */
export type ActionToken = Readonly<{ actionId: ActionId; generation: number }>;
export type ActionIntent =
  | Readonly<{ kind: 'clear-camp'; memberIds: readonly string[] }>
  | Readonly<{ kind: Exclude<Subgoal['kind'], 'clear-camp'> | 'defend-site' | 'recall' | 'wait-in-cover' | 'load' | 'sail' | 'unload'
      | 'attack-site' | 'contest-route' | 'counter-harass' | 'recover-site' }>;
export type AllocationReason = Readonly<{ code: string; factIds: readonly string[];
  values: Readonly<Record<string, string | number | boolean | null>> }>;
export type AllocationUtility = Omit<Utility, 'benefit' | 'cost' | 'evidence'> & Readonly<{
  benefit: readonly Readonly<{ code: string; value: number }>[];
  cost: readonly Readonly<{ code: string; value: number }>[];
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
  force: ForceQuotation | null;
}>;
export type ExecutionAction = Readonly<{
  token: ActionToken;
  objectiveId: ObjectiveId;
  methodId: MethodId;
  executor: string;
  intent: ActionIntent;
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
    jobs: readonly Readonly<{ id: string | null; unitKind: TrainableUnitKind | null }>[] }>
    | Readonly<{ kind: 'construction'; buildingIds: readonly string[] }>;
}>;
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
  switchingCostGold: number | null;
  reason: AllocationReason;
}>;
type EventHeader = Readonly<{ id: AllocationEventId; tick: number; revision: number; objectiveId: ObjectiveId;
  methodId: MethodId; action: ActionToken; reason: AllocationReason }>;
export type AllocationEvent = EventHeader & (
  | Readonly<{ kind: 'incumbent-adopted'; leaseIds: readonly AllocationLeaseId[] }>
  | Readonly<{ kind: 'preempted'; quotation: PreemptionQuotation; handoff: 'pending' | 'shrink' | 'pause' | 'fail' }>
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
  objectives: Readonly<Record<ObjectiveId, ObjectiveAllocation>>;
  executions: Readonly<Record<ActionId, ExecutionAction>>;
  leases: Readonly<Record<ExclusiveResourceKey, ResourceLease>>;
  assignments: Readonly<Record<AssignmentId, FormalAssignment>>;
  budgets: Readonly<Record<string, AllocationBudget>>;
  voyages: Readonly<Record<string, VoyageAllocation>>;
  vacancies: Readonly<Record<string, AllocationVacancy>>;
  issuedOrders: Readonly<Record<string, IssuedActionOrder>>;
  /** Commands are stored once by id, retained only while an order or blocked parent references them. */
  issuedCommands: Readonly<Record<string, IssuedActionCommand>>;
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
  snapshot: GameSnapshot;
  owner: PlayerId;
  objective: DecisionFacts<Objective>;
  method: DecisionFacts<Method>;
  execution: ExecutionAction;
  grant: ActionGrant;
  events: readonly AllocationEvent[];
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
  handoffs: readonly Readonly<{ eventId: AllocationEventId; disposition: 'shrink' | 'pause' | 'fail' }>[];
}>;
export type ExecutableMethod = DecisionFacts<Method> & Readonly<{
  providerId: string;
  /** Stable preference within this objective, not a global defense/island priority. */
  preference: number;
  spends: readonly PlannedAllocationSpend[];
  voyagePlans?: readonly PlannedVoyage[];
  actions: readonly Readonly<{ id: ActionId; executor: string; intent: ActionIntent; target: Target; dependsOn: readonly ActionId[];
    demands: readonly ResourceDemand[]; spendIds: readonly string[]; completionEffects: readonly Effect[];
    /** Materialized bundle subset, including separate sources' assembly groups.
     * Omission is an unresolved skeleton, never permission to select globally. */
    unitIds?: readonly string[] }>[];
}>;
type MethodQuoteFacts = Readonly<{
  methodId: MethodId;
  force: ForceQuotation | null;
  reason: AllocationReason;
  valuation?: ValuationQuotation;
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
  /** Real current action records, including observed production results. The
   * caller supplies these on each transaction; providers keep no hidden history. */
  executions: readonly ExecutionAction[];
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
  revision: number;
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
