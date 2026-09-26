import type { PlayerId } from "../shared/types";

export type AiJobState = {
  id: string;
  kind: string;
  createdTick: number;
  updatedTick: number;
};

export type AiPolicyUnitClaimKind = "mercenary" | "creep" | "expansion" | "attack" | "harass" | "retreat" | "build";

export type AiPolicyUnitClaim = {
  kind: AiPolicyUnitClaimKind;
  targetId: string;
  x: number;
  y: number;
  sinceTick: number;
  expiresTick: number;
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
  general?: { mode: "defend" | "guard" | "attack" | "creep" | "hold"; target?: { x: number; y: number }; targetHallId?: string; holdingSince?: number; group?: string[]; groupStart?: number; enemyGaps?: Record<string, number>; stage?: "gather" | "strike"; stageSince?: number; leash?: number };
  casualties?: { count: number; lastChangeTick: number };
  // The camp V7 is creeping (see v7-creeping): where it stood, the gathering point, the stage and the group; and a camp
  // given up, not tried again until the tick given.
  creep?: { center: { x: number; y: number }; reach: number; staging: { x: number; y: number }; stage: "gather" | "engage"; since: number; group: string[] };
  creepRetry?: { center: { x: number; y: number }; until: number };
  plays?: Record<string, number>;
};

export type AiPolicyMemory = {
  jobs: AiJobState[];
  unitClaims: Record<string, AiPolicyUnitClaim>;
  strategicPlan?: AiStrategicPlan;
  perception?: Record<string, unknown>;
  v6?: V6PolicyMemory;
};

export function createAiPolicyMemory(): AiPolicyMemory {
  return { jobs: [], unitClaims: {} };
}
