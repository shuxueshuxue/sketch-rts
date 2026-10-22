import type { AiPolicyMemory } from '../memory';
import type { GameCommand, GameSnapshot, PlayerId, TrainableUnitKind, UnitKind, UnitOrder } from '../../shared/types';

/** Output contracts only: no policy registration, commands, memory or save fields.
 * The only component source is terrain.groundWholeAt(map, point, mover): use its
 * raw positive label with the mover prefix below; undefined is an unknown Location.
 * Labels are scoped to one map and mover, and exclude building obstructions. */
export type LandId = `land:${number}`;
export type SeaId = `sea:${number}`;
export type ObjectiveId = string;
export type MethodId = string;
export type AssignmentId = string;
export type Point = Readonly<{ x: number; y: number }>;
export type Evidence = Readonly<{
  source: string;
  tick: number;
  certainty: 'recorded' | 'inferred' | 'unknown';
  detail: string;
}>;
export type Reason = Readonly<{ code: string; detail: string; evidence: readonly Evidence[];
  /** Structured decision provenance survives projection without parsing prose. */
  factIds?: readonly string[];
  values?: Readonly<Record<string, string | number | boolean | null>>;
}>;

/** Component IDs use terrain connectivity, never a map ID or a home/island label. */
export type Location =
  | Readonly<{ kind: 'land'; landId: LandId; point: Point }>
  | Readonly<{ kind: 'sea'; seaId: SeaId; point: Point }>
  | Readonly<{ kind: 'aboard'; shipId: string; seaId: SeaId; compartment: 'deck' | 'cabin'; point: Point }>
  | Readonly<{ kind: 'unknown'; point: Point; reason: Reason }>;
export type Target = Readonly<{ entityId?: string; landId?: LandId; seaId?: SeaId; point: Point }>;

/** Relative tick durations. Infinity/NaN must not be used to encode an unavailable route. */
export type Arrival =
  | Readonly<{ status: 'reachable'; ticks: number; landTicks: number; crossings: readonly (CrossingEta & Readonly<{ requiresNewShip: false }>)[]; evidence: readonly Evidence[] }>
  | Readonly<{ status: 'conditional'; ticks: number; landTicks: number; crossings: readonly CrossingEta[]; unmet: readonly Reason[]; evidence: readonly Evidence[] }>
  | Readonly<{ status: 'unreachable' | 'unknown'; reason: Reason;
    /** Physical lower bound, not an ETA estimate or proof for a longer window. */
    lowerBoundTicks?: number }>;
export type CrossingEta = Readonly<{
  seaId: SeaId;
  shipId: string | null;
  /** The exact producer used for a conditional new hull and its approach ETA. */
  productionBuildingId?: string;
  departure: Point;
  landing: Point;
  /** Same native boarding berth used by the execution grant. */
  departureGround?: Point;
  departureHeading?: number;
  landingHeading?: number;
  /** Actual land-side unload point, distinct from the boat's water-side stop. */
  landingGround?: Point;
  /** Additional wait after the embarkation walk, excluding time already spent walking. */
  waitTicks: number;
  boardingTicks: number;
  /** Absolute completion forecast of embarkation, evaluated in this snapshot.
   * Absent for already loaded units or an unquoted loading schedule. */
  expectedLoadedTick?: number;
  sailingTicks: number;
  unloadingTicks: number;
  /** A newly built ship is a method prerequisite, not an already available hull. */
  requiresNewShip: boolean;
}>;
export type UnitRole = 'frontline' | 'ranged' | 'caster' | 'healer' | 'worker' | 'transport' | 'warship';
export type Commitment = Readonly<{
  source: string;
  objectiveId: ObjectiveId | null;
  taskId: string;
  role: UnitRole;
  evidence: Evidence;
}>;
export type SituationUnit = Readonly<{
  id: string;
  owner: PlayerId;
  kind: UnitKind;
  location: Location;
  hp: number;
  maxHp: number;
  /** Existing V6 field-strength currency; camp clearing is assessed per target. */
  strength: number;
  roles: readonly UnitRole[];
  expiresTick: number | null;
  /** Input commitments may overlap: observation must expose, not silently resolve, a conflict. */
  commitments: readonly Commitment[];
  arrivals: readonly Readonly<{ targetId: string; arrival: Arrival }>[];
}>;
/** Native production limits, distinct from current income or a staffing forecast.
 * The cap is before upkeep. standardWorkers is an economy allocation target,
 * not a claim that every worker produces cap / standardWorkers on every route. */
export type MiningCapacity = Readonly<{
  goldPerTickCap: number;
  standardWorkers: number;
  staffedWorkerIds: readonly string[];
  goldPerTrip: number;
  gatherTicks: number;
  entryIntervalTicks: number;
}>;
export type Asset = Readonly<{
  id: string;
  owner: PlayerId;
  kind: 'hall' | 'mine' | 'tower' | 'production' | 'worker' | 'shipyard';
  target: Target;
  hp: number | null;
  complete: boolean;
  replacementGold: number;
  remainingGold: number;
  incomeGoldPerTick: number;
  /** Mine-only physical facts. A prospective staffing curve is quoted separately. */
  miningCapacity?: MiningCapacity;
  discountedValueGold: number;
}>;
export type SiteThreat = Readonly<{
  siteId: string;
  horizonTicks: number;
  attackers: readonly Readonly<{ unitId: string; arrival: Arrival; strength: number;
    /** Current native activity is separate from a route the enemy could choose.
     * One enemy has at most one actual site; other sites retain redirect risk. */
    intent?: Readonly<{ kind: 'actual-intrusion' | 'potential-redirect'; actualSiteId: string | null; redirectGroupId: string;
      basis: 'native-target' | 'native-destination' | 'native-unload' | 'hostile-presence' | 'potential-route' }> }> [];
  arrivedStrength: number;
  /** Not yet at the site; disjoint from arrivedStrength. */
  incomingStrength: number;
  friendlyOnStationStrength: number;
  firstArrivalTicks: number | null;
  lossProbability: number | null;
  evidence: readonly Evidence[];
}>;
export type LandSituation = Readonly<{
  id: LandId;
  anchor: Point;
  assetIds: readonly string[];
  unitIds: readonly string[];
  adjacentSeaIds: readonly SeaId[];
  threats: readonly SiteThreat[];
}>;
export type SeaSituation = Readonly<{
  id: SeaId;
  anchor: Point;
  transportIds: readonly string[];
  warshipIds: readonly string[];
  shipyardIds: readonly string[];
  voyages: readonly Readonly<{ shipId: string; taskId: string; target: Target; freeInTicks: number | null; evidence: Evidence }>[];
}>;
export type Opportunity = Readonly<{
  id: string;
  kind: 'neutral-mine' | 'weak-site' | 'construction' | 'army-away' | 'route' | 'lost-site';
  target: Target;
  valueGold: number;
  evidence: readonly Evidence[];
}>;
export type Situation = Readonly<{
  tick: number;
  owner: PlayerId;
  horizonTicks: number;
  lands: readonly LandSituation[];
  seas: readonly SeaSituation[];
  /** Assets and units live once here; region lists contain IDs, not additional value to sum. */
  assets: readonly Asset[];
  units: readonly SituationUnit[];
  opportunities: readonly Opportunity[];
  economy: Readonly<{ cashGold: number; predictedIncomeGold: number; horizonTicks: number; ledger: readonly BudgetEntry[] }>;
  limitations: readonly Reason[];
}>;

export type ObjectiveKind = 'DefendSite' | 'RecoverSite' | 'ExpandLand' | 'ConquerIsland'
  | 'ReinforceFront' | 'AttackSite' | 'ContestRoute' | 'CounterHarass' | 'Evacuate';
export type Effect =
  | Readonly<{ kind: 'site-safe'; siteId: string; throughTick: number }>
  | Readonly<{ kind: 'mining-established'; mineId: string; completeHall: true; garrisonHandoff: true; garrisonThroughTick?: number }>
  | Readonly<{ kind: 'force-present'; landId: LandId; minimumStrength: number; throughTick: number }>
  | Readonly<{ kind: 'entity-destroyed'; entityId: string }>
  | Readonly<{ kind: 'route-controlled'; target: Target }>
  | Readonly<{ kind: 'harassment-ended'; unitId: string; siteId: string }>
  | Readonly<{ kind: 'assets-evacuated'; unitIds: readonly string[]; destination: Target }>;
/** All terms share the evaluator's declared gold-equivalent scale and time horizon. */
/** Catalogued unit assets represented by this numerical term. Keep identity
 * outside prose so preserved value and permanent loss cannot charge it twice. */
export type CatalogUnitValue = Readonly<{ unitId: string; valueGold: number }>;
export type UtilityTerm = Readonly<{ code: string; value: number; explanation: string;
  catalogUnitValues?: readonly CatalogUnitValue[] }>;
export type Utility = Readonly<{
  horizonTicks: number;
  /** Costs incurred only on success are negative benefit terms. */
  benefit: readonly UtilityTerm[];
  /** Expected committed costs, including failed attempts, are not discounted by success. */
  cost: readonly UtilityTerm[];
  successProbability: number;
  persistenceBonus: number;
  /** successProbability * sum(benefit) - sum(cost) + persistenceBonus. */
  score: number;
  evidence: readonly Evidence[];
}>;
/** Common valuation epoch: now through task completion plus a holding period.
 * Every compared cash flow and alternative uses this exact window/rate. */
export type ValuationWindow = Readonly<{ taskTicks: number; holdingTicks: number; horizonTicks: number; discountTicks: number }>;
/** Half-open relative tick interval. Native training and research advance in
 * independent lanes, even when they belong to the same building. */
export type ProductionUse = Readonly<{ buildingId: string; lane: 'training' | 'research'; fromTicks: number; throughTicks: number }>;
/** Migration-only bound on an executed old task, not its invented exact value. */
export type ImportedLossUpperBound = Readonly<{ targetId: string; gold: number; window: ValuationWindow;
  components: readonly Readonly<{ code: string; valueGold: number; factIds: readonly string[] }>[] }>;
/** Formal gathering displacement. Progress survives removal; loss prices only
 * the separately proved delay, never the migration envelope or a payoff lower bound. */
export type AssemblyDelayLossUpperBound = Readonly<{
  targetId: string; gold: number; window: ValuationWindow; continuationUpperGold: number;
  mode: 'scenario-delay' | 'scenario-continuation' | 'whole-value-cap';
  components: readonly Readonly<{ code: string; valueGold: number; factIds: readonly string[] }>[];
}>;
export type AssemblyDisplacementQuote = Readonly<{ status: 'known'; bound: AssemblyDelayLossUpperBound }>
  | Readonly<{ status: 'unknown'; reasonCode: string }>;
export type PricedOpportunityAlternative = Readonly<{ objectiveId: ObjectiveId; unitIds: readonly string[];
  production?: readonly ProductionUse[]; marginalGold: number; withResourcesGold: number;
  withoutResourcesGold: number | null; basis: 'exact' | 'conservative-bound' | 'upper-bound' | 'assembly-delay-upper-bound';
  upperBound?: ImportedLossUpperBound; assemblyDelayUpperBound?: AssemblyDelayLossUpperBound }>;
export type OpportunityAlternative = Readonly<{
  objectiveId: ObjectiveId;
  unitIds: readonly string[];
  production?: readonly ProductionUse[];
  withResourcesGold: number;
  withoutResourcesGold: number | null;
  withoutResourcesStatus: 'feasible' | 'not-runnable' | 'unknown';
  committed: boolean;
  upperBound?: ImportedLossUpperBound;
  assemblyDelayUpperBound?: AssemblyDelayLossUpperBound;
}>;
export type OpportunityCostQuote = Readonly<{ window: ValuationWindow }> & (
  | Readonly<{ status: 'known'; gold: number; basis: 'feasible-bundle-quotes' | 'no-positive-feasible-alternative';
    alternatives: readonly PricedOpportunityAlternative[];
    /** All actual displacements survive portfolio deduplication for admission. */
    displacements?: readonly PricedOpportunityAlternative[] }>
  | Readonly<{ status: 'unknown'; objectiveIds: readonly ObjectiveId[]; reason: Readonly<{ code: string }> }>
);
export type OpportunityRequest = Readonly<{ objectiveId: ObjectiveId; methodId: MethodId | null;
  unitIds: readonly string[]; production?: readonly ProductionUse[]; window: ValuationWindow }>;
export type ValuationContext = Readonly<{
  phase: 'gross' | 'net';
  holdingTicks?: number;
  discountTicks?: number;
  /** Override when repricing an alternative in the requesting bundle's window. */
  window?: ValuationWindow;
  /** Requote an alternative after removing these resources. It may not silently
   * replace them with another objective's ungranted cohort. */
  unavailableUnitIds?: readonly string[];
  /** Explicit original cohort when repricing a marginal alternative. */
  allowedUnitIds?: readonly string[];
  unavailableProduction?: readonly ProductionUse[];
  /** Repricing may move a job in time, but cannot invent an ungranted factory. */
  allowedProduction?: readonly Pick<ProductionUse, 'buildingId' | 'lane'>[];
  opportunity?: (request: OpportunityRequest) => OpportunityCostQuote;
}>;
export type ValuationQuotation = Readonly<{ phase: 'gross' | 'net'; window: ValuationWindow;
  unitIds: readonly string[]; production?: readonly ProductionUse[]; opportunity: OpportunityCostQuote | null }>;
export type Objective = Readonly<{
  id: ObjectiveId;
  kind: ObjectiveKind;
  owner: PlayerId;
  target: Target;
  effects: readonly Effect[];
  /** An unavailable quote has score=null, never a numeric sentinel. */
  utility: Omit<Utility, 'score'> & { score: number | null };
  /** Conditional valuation supplied by the family, never a committed payoff. */
  conditionalQuote?: Readonly<{ potentialUtility: Utility | null; assumptions: readonly Reason[];
    includedPrerequisiteUtilityCodes: readonly string[] }>;
  status: 'candidate' | 'active' | 'blocked' | 'complete' | 'failed' | 'abandoned';
  sinceTick: number;
  /** Only feasible quotes have a rank. Blocked and terminal goals have null. */
  rank: number | null;
  reasons: readonly Reason[];
  methodIds: readonly MethodId[];
  valuation?: ValuationQuotation;
  /** Supporting objectives share the parent's payoff; do not sum it twice. */
  supportsObjectiveIds?: readonly ObjectiveId[];
  /** Different plans establishing the same effect; their payoffs are alternatives. */
  alternativeObjectiveIds?: readonly ObjectiveId[];
  stability: Readonly<{ minimumStayUntilTick: number; challengerId: ObjectiveId | null; challengerThinks: number }>;
}>;

export type ResourceDemand =
  | Readonly<{ kind: 'force'; metric: 'field-strength' | 'camp-force'; strength: number; roles: readonly UnitRole[]; at: Target; neededByTick: number | null; permanent: boolean }>
  | Readonly<{ kind: 'transport'; seaId: SeaId; payloadMass: number; departure: Point; landing: Point }>
  | Readonly<{ kind: 'gold'; amount: number }>
  | Readonly<{ kind: 'production'; buildingId: string | null; unitKind: TrainableUnitKind; count: number }>
  | Readonly<{ kind: 'workers'; count: number; at: Target }>
  | Readonly<{ kind: 'supply'; amount: number }>;
export type Precondition = Readonly<{
  id: string;
  kind: 'route' | 'force' | 'transport' | 'shore-safe' | 'budget' | 'production' | 'workers' | 'supply' | 'handoff';
  status: 'met' | 'unmet' | 'unknown';
  reason: Reason;
  demand: ResourceDemand | null;
  /** IDs of alternative subgoals which can establish this condition. */
  subgoalIds: readonly string[];
}>;
export type Subgoal = Readonly<{
  id: string;
  parentMethodId: MethodId;
  kind: 'borrow-force' | 'assemble-force' | 'train-force' | 'train-worker' | 'obtain-transport' | 'build-shipyard' | 'train-transport'
    | 'clear-beachhead' | 'change-landing' | 'deliver-force' | 'clear-camp' | 'deliver-workers'
    | 'build-hall' | 'start-mining' | 'establish-garrison' | 'build-production' | 'provide-supply' | 'wait-income' | 'recover' | 'evacuate';
  target: Target;
  demands: readonly ResourceDemand[];
  dependsOn: readonly string[];
  estimatedTicks: number | null;
  status: 'proposed' | 'blocked' | 'active' | 'complete' | 'failed' | 'abandoned';
  reasons: readonly Reason[];
}>;
export type Method = Readonly<{
  id: MethodId;
  objectiveId: ObjectiveId;
  kind: 'local-squad' | 'main-army-recall' | 'wait-in-cover' | 'cross-sea-reinforcement'
    | 'direct-conquest' | 'staged-beachhead' | 'land-expansion' | 'land-attack'
    | 'route-pressure' | 'counter-harassment' | 'recovery' | 'evacuation' | 'goal-plan';
  preconditions: readonly Precondition[];
  subgoals: readonly Subgoal[];
  demands: readonly ResourceDemand[];
  estimatedTicks: number | null;
  status: 'candidate' | 'selected' | 'blocked' | 'complete' | 'failed' | 'abandoned';
  reasons: readonly Reason[];
}>;

export type AssignmentStage = 'assigned' | 'en-route' | 'on-station';
export type Assignment = Readonly<{
  id: AssignmentId;
  objectiveId: ObjectiveId;
  methodId: MethodId | null;
  unitId: string;
  role: UnitRole;
  target: Target;
  sinceTick: number;
  minimumStayUntilTick: number;
  arrival: Arrival;
  /** Projected old tasks are not commitments created by the new allocator. */
  authority: 'observed' | 'proposed' | 'committed';
  evidence: readonly Evidence[];
}> & (
  | Readonly<{ stage: AssignmentStage }>
  | Readonly<{ stage: 'life-saving-interruption'; resumeStage: AssignmentStage; interruption: Readonly<{
    kind: 'worker-safety' | 'shell-evasion' | 'retreat' | 'healing'; sinceTick: number; executor: string; reason: Reason;
  }> }>
);
export type PreemptionEvent = Readonly<{
  tick: number;
  fromObjectiveId: ObjectiveId;
  toObjectiveId: ObjectiveId;
  assignmentIds: readonly AssignmentId[];
  unitIds: readonly string[];
  marginalBenefit: number;
  displacedLoss: number;
  switchingCost: number;
  reason: Reason;
  /** A borrower cannot silently count borrowed units as casualties of the old objective. */
  handoff: 'pending' | 'shrink' | 'pause' | 'fail';
}>;
export type BudgetEntry = Readonly<{
  id: string;
  objectiveId: ObjectiveId | null;
  methodId: MethodId | null;
  subgoalId: string | null;
  gold: number;
  state: 'proposed' | 'reserved' | 'spent' | 'released';
  authority: 'observed' | 'proposed' | 'committed';
  sinceTick: number;
  releaseWhen: readonly ('spent' | 'completed' | 'failed' | 'abandoned' | 'expired')[];
  releasedTick: number | null;
  evidence: readonly Evidence[];
}>;

/** Shared join contract for the death ledger; damage sources/classification belong to that ledger. */
export type DeathAttributionContext = Readonly<{
  objectiveId: ObjectiveId | null;
  methodId: MethodId | null;
  assignmentId: AssignmentId | null;
  task: Readonly<{ source: string; id: string }> | null;
  assignmentStage: Assignment['stage'] | null;
  executor: string | null;
  action?: Readonly<{ actionId: string; generation: number }>;
  executionPhase?: string;
  plannedExecutor?: string;
  allocationRevision?: number;
  provenance: 'assignment' | 'inferred' | 'unknown';
  /** Preserve conflicting old-task evidence rather than inventing one certain objective. */
  commitments: readonly Commitment[];
  order: Readonly<UnitOrder>;
  issuedCommand: Readonly<GameCommand> | null;
  orderTick: number | null;
  location: Location;
  /** Unknown must be explicit; lack of an allocation is not evidence of a normal combat death. */
  evidence: readonly Evidence[];
}>;
/** Adjustable force not serving a positive-utility objective. Each unit appears
 * once; costs are alternatives, not additional costs to charge every candidate. */
export type IdleForce = Readonly<{
  unitIds: readonly string[];
  /** Nonnegative gold equivalent of the best feasible attack/pressure forgone;
   * the idle alternative has utility -opportunityCostGold. */
  opportunityCostGold: number;
  /** Null when no feasible positive alternative is known; explain in reason. */
  alternativeObjectiveId: ObjectiveId | null;
  reason: Reason;
}>;
export type StrategyPlanTrace = Readonly<{
  schemaVersion: 1;
  tick: number;
  owner: PlayerId;
  mode: 'observe' | 'control';
  /** Present only for the formal controller; observation assignments remain distinguishable. */
  allocation?: import('./allocation-types').StrategyAllocationTrace;
  situation: Situation;
  objectives: readonly Objective[];
  /** Utility order over feasible quotes only; objectives above is the unique table. */
  feasibleObjectiveIds: readonly ObjectiveId[];
  blockedObjectives: readonly BlockedObjectiveQuote[];
  methods: readonly Method[];
  assignments: readonly Assignment[];
  preemptions: readonly PreemptionEvent[];
  budget: readonly BudgetEntry[];
  idleForces: readonly IdleForce[];
  limitations: readonly Reason[];
}>;
export type BlockedObjectiveQuote = Readonly<{
  objectiveId: ObjectiveId;
  missingPreconditions: readonly Readonly<{ methodId: MethodId; preconditionId: string;
    kind: Precondition['kind']; status: 'unmet' | 'unknown'; reason: Reason }>[];
  potentialUtility: Utility | null;
  potentialAssumptions: readonly Reason[];
  /** Alternatives are not summed. Included terms must not be charged twice. */
  prerequisiteCost: readonly Readonly<{ methodId: MethodId; knownGold: number;
    unknown: readonly Reason[]; alreadyIncludedUtilityCodes: readonly string[] }>[];
}>;
export type PlanningContext = Readonly<{ snapshot: GameSnapshot; owner: PlayerId; memory: AiPolicyMemory;
  teams?: NonNullable<GameSnapshot['teams']>;
  valuation?: ValuationContext }>;
/** Outcomes already accepted by the ordinary planner; no second policy pass. */
export type SituationObservation = Readonly<{
  healing: readonly Readonly<{ unitId: string; executor: string }>[];
}>;
export interface SituationEvaluator {
  /** Borrowed inputs: do not mutate serialized state; per-think query reuse is allowed. */
  evaluate(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory, previous?: Situation): Situation;
}
export interface ObjectiveGenerator {
  generate(situation: Situation, context: PlanningContext, previous: readonly import('./observation-memory').PreviousObjective[]): readonly Objective[];
}
export interface MethodPlanner {
  decompose(situation: Situation, objective: Objective, context: PlanningContext): readonly Method[];
}

export type AllocationResult = Readonly<{
  assignments: readonly Assignment[];
  preemptions: readonly PreemptionEvent[];
  budget: readonly BudgetEntry[];
  unmet: readonly Readonly<{ objectiveId: ObjectiveId; demand: ResourceDemand; reason: Reason }>[];
}>;
export interface Allocator {
  allocate(situation: Situation, objectives: readonly Objective[], methods: readonly Method[],
    previous: AllocationResult): AllocationResult;
}
