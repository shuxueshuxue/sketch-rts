import type { ItemKind, PlayerId } from "../shared/types";

export type AiJobState = {
  id: string;
  kind: string;
  createdTick: number;
  updatedTick: number;
};

export type AiPolicyUnitClaimKind = "mercenary" | "creep" | "expansion" | "attack" | "harass" | "retreat" | "build"
  | "mineRally" | "mineLeash" | "mineGuard" | "workerSafety" | "expansionGarrison" | "expansionMission" | "harassSquad";

export type WorkerEvacuation = { origin: { x: number; y: number }; resourceId?: string;
  shelter: { x: number; y: number }; safeResourceId?: string };

export type AiPolicyUnitClaim = {
  kind: AiPolicyUnitClaimKind;
  targetId: string;
  x: number;
  y: number;
  sinceTick: number;
  expiresTick: number;
  arrived?: boolean;
  returning?: boolean;
  resumeKind?: 'mineRally' | 'mineGuard';
  evacuation?: WorkerEvacuation;
  localRetreat?: { x: number; y: number };
  // Construction-screen membership survives the shorter ordinary movement claim.
  // expansionMission is the membership-only kind when that movement claim has ended.
  expansionMineId?: string;
  // Healthy soldiers cover construction temporarily; recovering guards keep the post after healing.
  garrisonTemporary?: boolean;
};

export type AiStrategicPlan = {
  focusTargetOwner?: PlayerId;
  focusTargetId?: string;
  focusTargetSinceTick?: number;
  focusTargetUpdatedTick?: number;
  expansionAttemptTick?: number;
  expansionClaimTargetId?: string;
  expansionClaimTick?: number;
};

// V6's modules keep their own state here: squads they own, the opening they chose, and which plays they have run.
export type V6PolicyMemory = {
  doctrine?: { profileId: string; strategyId: string; decidedTick: number };
  // The strategy phase V6 has reached, and since when each unmet economy goal has waited (for priority ageing).
  phase?: number;
  goalAges?: Record<string, { since: number; seen: number }>;
  opening?: { kind: "towerRush" | "fastExpand" | "standard"; target?: PlayerId; decidedTick: number };
  raidCooldownUntil?: number;
  retreatedAt?: number;
  raid?: { unitIds: string[]; startStrength?: number; targetHallId: string; targetOwner: PlayerId; reason: string; sinceTick: number; phase: "travel" | "strike" | "home" };
  closeout?: { unitIds: string[]; targetId: string; sinceTick: number };
  general?: { mode: "defend" | "guard" | "attack" | "creep" | "hold"; target?: { x: number; y: number }; targetHallId?: string; holdingSince?: number; group?: string[]; groupStart?: number; enemyGaps?: Record<string, number>; enemyCenters?: Record<string, { x: number; y: number }>; stage?: "gather" | "strike"; stageSince?: number; leash?: number; quick?: boolean; baseTrade?: boolean };
  casualties?: { count: number; lastChangeTick: number };
  // The camp V7 is creeping (see v7-creeping): where it stood, the gathering point, the stage and the group; and a camp
  // given up, not tried again until the tick given.
  creep?: { center: { x: number; y: number }; reach: number; staging: { x: number; y: number }; stage: "gather" | "engage"; since: number; group: string[] };
  creepRetry?: { center: { x: number; y: number }; until: number };
  // V9's errand to a shop (see @@@v9-shop): which unit buys what where, since when.
  shop?: { shopId: string; kind: ItemKind; unitId: string; since: number };
  plays?: Record<string, number>;
};

// The naval script's plans (see @@@ai-naval), each with the tick it was looked for: the island's mine and the water a ship
// lands at, the assault's target and its water, the raid's water.
export type MiningMissionMemory = {
  mineId: string;
  sinceTick: number;
  stage: 'fund' | 'assemble' | 'clear' | 'escort' | 'build' | 'complete';
  /** Diagnostic only; never used to choose units, stages, orders or retries. */
  reason?: string;
  staging?: { x: number; y: number };
  stagingCheckedTick?: number;
  roadCamp?: { x: number; y: number };
  combat?: Pick<V6PolicyMemory, 'creep' | 'creepRetry'>;
  interruptions: { tick: number; reason: 'home-threat' | 'mining-threat' | 'mine-threat' | 'camp-threat'; targetId?: string }[];
  paused?: boolean;
  pausedAt?: number;
};

export type NavalConquestMemory = MiningMissionMemory & {
  landing: { x: number; y: number };
  reason: string;
  abandonedTick?: number;
};

export type NavalPlanMemory = {
  conquests?: Record<string, NavalConquestMemory>;
  ferryDecisions?: Record<string, { tick: number; reason: string; lastBlock?: { tick: number; reason: string } }>;
  firstCombatDelivery?: {
    firstShipTick: number; deadlineTick: number; routeBudgeted?: boolean; overdueTick?: number;
    firstMinuteBlock?: { tick: number; reason: string };
    deliveredTick?: number; deliveredShipId?: string; deliveredUnitId?: string;
    attempts: Record<string, { firstSeenTick: number; passengerIds: string[];
      reason: string; tick: number; targetId?: string; lostTick?: number }>;
  };
  combat?: Record<string, { targetId: string; commandTargetId?: string }>;
  muster?:{at:{x:number;y:number};goal:{x:number;y:number};leader:string;sinceTick:number;launched:boolean;heading?:number};
  outfit?: {shipId:string; workerId?:string; mountId:string; itemId?:string; kind:'shipCannon'|'shipMortar'; progress?:{tick:number;x:number;y:number;workerX:number;workerY:number;itemId?:string}};
  outfitRetryUntil?: number;
  ferries?: Record<string, ({ purpose: "settle" | "assault" | "rebase" | "evacuate" | "advance" | "reinforce" } | { purpose: "creep"; riderId: string })
    & {targetId:string;from:{x:number;y:number};to:{x:number;y:number};phase:"loading"|"sailing"|"return";crewIds:string[];sinceTick:number;reinforcementTaskId?:string;payloadIds?:string[];deliveries?:{tick:number;unitIds:string[]}[];returnTrips?:number;progress?:{tick:number;x:number;y:number;heading:number;phase:string;crew:string}}>;
  ferryRetryUntil?: Record<string,number>;
  ferryFailures?: Record<string, Record<string, { attempts: number; tick: number; reason: string }>>;
  // One candidate per resource island; paid routes survive a temporary local opportunity.
  islands?: { tick: number; plans: { mineId: string; landing: { x: number; y: number } }[] };
  expeditions?: { mineId: string; landing: { x: number; y: number } }[];
  island?: { tick: number; plan?: { mineId: string; landing: { x: number; y: number } } };
  assault?: { tick: number; plan?: { targetId: string; landing: { x: number; y: number } } };
  raid?: { tick: number; water?: { x: number; y: number } };
};

export type AiPolicyMemory = {
  /** Serialized observation publication/history; does not assign units or budget. */
  strategy?: { observation: import('./strategy/observation-memory').StrategyObservationMemory };
  /** Formal resource authority; independent of optional observation publication/history. */
  strategyAllocation?: import('./strategy/allocation-types').StrategyAllocationMemory;
  /** Opt-in declarative search evidence only; not command/resource authority. */
  goalPlanning?: import('./strategy/goal-planner-input').GoalPlannerRuntimeMemory;
  goalPlanningReferences?: import('./strategy/goal-planning-references').GoalPlanningReferences;
  goalSearch?: import('./strategy/goal-search-format').GoalSearchMemory;
  /** Native publication/service state survives removal of old search data.
   * Its reachable definitions remain charged until the source-key migration. */
  goalPublications?: import('./strategy/goal-search-migration').GoalPublicationMemory;
  territory?: {
    idleTicks: number; lastTick: number; idle: boolean; retryUntil?: number;
    objective?: { targetId: string; point: { x: number; y: number }; sinceTick: number; reachedTick?: number; nextStepCheck?: number; slots?: { x: number; y: number }[] } | undefined;
    lastAction?: { tick: number; kind: 'post' | 'attack'; targetId: string };
  };
  landAttack?: {
    targetId: string;
    sinceTick: number;
    general: NonNullable<V6PolicyMemory['general']>;
    camp?: NonNullable<V6PolicyMemory['creep']>;
    paused?: 'defense' | 'expansion';
    pausedAt?: number;
  };
  landAttackResult?: { targetId: string; tick: number; result: 'destroyed' | 'army-lost' | 'withdrew'; reason: string };

  harassDefense?: { hallId: string; targetId: string; point: { x: number; y: number } };
  miningLeash?: { hallId: string; point: { x: number; y: number } };
  miningDefense?: { hallId: string; point: { x: number; y: number };
    attackerIds: string[]; protectedHp: Record<string, number>; phase: 'gather' | 'fight' };
  landExpansion?: MiningMissionMemory;
  // Posts awaiting their own static defense. Unit membership lives only in unitClaims.
  expansionGarrisons?: Record<string, { mineId: string; sinceTick: number }>;
  mounted?: {
    unitIds: string[];
    objective: { kind: 'camp'; ids: string[] } | { kind: 'raid'; hallId: string; owner: PlayerId };
  }[];
  support?: { baseId: string; unitIds: string[]; sinceTick: number };
  jobs: AiJobState[];
  unitClaims: Record<string, AiPolicyUnitClaim>;
  strategicPlan?: AiStrategicPlan;
  perception?: Record<string, unknown>;
  v6?: V6PolicyMemory;
  naval?: NavalPlanMemory;
  loot?: { unitId: string; itemId: string; homeId: string; returning: boolean };
  shopping?: { unitId: string; shopId: string; kind: ItemKind; homeId: string; returning: boolean };
  mercenaryCourier?: { unitId: string; campId: string };
};

export function createAiPolicyMemory(): AiPolicyMemory {
  return { jobs: [], unitClaims: {} };
}
