import type { GameCommand, GameSnapshot, AiScriptVersion, PlayerId, TrainableUnitKind } from "../../shared/types";
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
  doctrines?: readonly import("./v6/doctrine").V6Strategy[];
  armyWants?: readonly import("./v6/doctrine").V6Want[];
  teams?: Partial<Record<PlayerId, string>>;
  version?: AiScriptVersion;
  requestedVersion?: AiScriptVersion;
  policyMode?: "melee" | "combat";
  disabledBehaviors?: AiBehaviorId[];
  telemetry?: AiTelemetry;
  memory?: AiPolicyMemory;
};

export type AiPolicyContext = PresetAiPolicyOptions & {
  memory: AiPolicyMemory;
  /** The room expansion's existing force request, before optional purchases. */
  expansionRecruit?: { unit: TrainableUnitKind; count: number } | undefined;
};

export type LocalScript = (snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) => GameCommand | GameCommand[] | undefined;

export type AiScript = {
  id: string;
  phase: "economy" | "tactics";
  run: LocalScript;
  // Local orders support the current task; strategic orders assign a different task. Undeclared scripts redirect.
  redirects?: 'strategic' | 'local';
  /** Maximum displacement of an assembly/escort station; travel keeps the executor's acceptance radius. */
  landStationRadius?: number;
  // Units only this script may move or send to attack; every other script's orders for them are dropped.
  claimsUnits?: (snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) => ReadonlySet<string>;
  // Commit this script's assignments from accepted orders before the next script reads them.
  onCommands?: (snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, commands: readonly GameCommand[]) => void;
  // Finalize task ownership from the complete plan after all claims and command conflicts were resolved.
  afterPlan?: (snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, entries: readonly AiCommandEntry[], scripts: readonly AiScript[]) => void;
};

export type AiCommandEntry = {
  navigation?: import('./navigation-intent').AiNavigationIntent;
  scriptId: string;
  command: GameCommand;
};
