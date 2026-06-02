import type { PlayerId } from "../shared/types";

export type AiJobState = {
  id: string;
  kind: string;
  createdTick: number;
  updatedTick: number;
};

export type AiPolicyUnitClaimKind = "mercenary" | "creep" | "expansion" | "attack" | "harass" | "retreat";

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
  focusTargetSinceTick?: number;
  focusTargetUpdatedTick?: number;
};

export type AiPolicyMemory = {
  jobs: AiJobState[];
  unitClaims: Record<string, AiPolicyUnitClaim>;
  strategicPlan?: AiStrategicPlan;
  perception?: Record<string, unknown>;
};

export function createAiPolicyMemory(): AiPolicyMemory {
  return { jobs: [], unitClaims: {} };
}
