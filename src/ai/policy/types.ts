import type { GameCommand, GameSnapshot, AiScriptVersion, PlayerId } from "../../shared/types";
import type { AiPolicyMemory } from "../memory";

export type { AiScriptVersion } from "../../shared/types";

export type AiBehaviorId = "workerHarassment" | "earlyHarassment" | "skirmishPreservation" | "expansionRegroup" | "economicCatchUp";

export type AiBehaviorStats = {
  attempts: number;
  workerRaidCommands: number;
  retreatCommands: number;
  disabledSkips: number;
  disadvantagedRetreats: number;
  woundedMeleeSaves: number;
  woundedRangedPullbacks: number;
  rangedKites: number;
  expansionRegroupRetreats: number;
  catchUpExpansions: number;
  catchUpTowers: number;
};

export type AiTelemetry = {
  behaviors: Record<AiBehaviorId, AiBehaviorStats>;
};

export type PresetAiPolicyOptions = {
  teams?: Partial<Record<PlayerId, string>>;
  version?: AiScriptVersion;
  policyMode?: "melee" | "combat";
  disabledBehaviors?: AiBehaviorId[];
  telemetry?: AiTelemetry;
  memory?: AiPolicyMemory;
};

export type AiPolicyContext = PresetAiPolicyOptions & {
  memory: AiPolicyMemory;
};

export type LocalScript = (snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) => GameCommand | GameCommand[] | undefined;

export type AiScript = {
  id: string;
  phase: "economy" | "tactics";
  run: LocalScript;
};

export type AiCommandEntry = {
  scriptId: string;
  command: GameCommand;
};
