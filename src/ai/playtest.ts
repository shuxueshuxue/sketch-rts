import { applyInteractivePlaytestCommand, inspectInteractivePlaytestUnits, stepInteractivePlaytestSession, stepInteractivePlaytestUntil, summarizeInteractivePlaytestSession, type InteractivePlaytestCommand, type InteractivePlaytestCondition, type InteractivePlaytestInspectedUnit, type InteractivePlaytestSession, type InteractivePlaytestSummary, type InteractivePlaytestUnitInspection, type InteractivePlaytestUnitInspectionOwner, type InteractivePlaytestUntilOptions, type InteractivePlaytestUntilResult } from "../sdk/playtest";
import { createAiRuntime, planPresetAiRuntimeCommands, type AiRuntimeState } from "./runtime";
import type { AiScript, PresetAiPolicyOptions } from "./policy";
import { pruneAiPolicyMemory, recordAiMemoryForCommands } from "./policy/claims";
import type { AiScriptVersion, PlayerId } from "../shared/types";
import { snapshotGame } from "../shared/sim";
import { createAiPolicyMemory, type AiPolicyMemory, type AiPolicyUnitClaim } from "./memory";
import { SIM_TICKS_PER_SECOND } from "../shared/time";

export type AiInteractivePlaytestRuntimeOptions = {
  assistControlled?: boolean;
  thinkInterval?: number;
  scripts?: AiScript[];
  scriptIds?: string[];
  scriptIdsByPlayer?: Partial<Record<PlayerId, string[]>>;
  version?: AiScriptVersion;
  versions?: Partial<Record<PlayerId, AiScriptVersion>>;
  policyMode?: PresetAiPolicyOptions["policyMode"];
  disabledBehaviorsByPlayer?: NonNullable<AiRuntimeState["disabledBehaviorsByPlayer"]>;
};

export type AiInteractivePlaytestMemorySummary = {
  jobs: { id: string; kind: string; createdGameSecond: number; updatedGameSecond: number }[];
  claims: {
    unitId: string;
    kind: AiPolicyUnitClaim["kind"];
    targetId: string;
    x?: number;
    y?: number;
    sinceGameSecond: number;
    expiresGameSecond: number;
  }[];
  strategicPlan?: {
    focusTargetOwner?: PlayerId;
    focusTargetId?: string;
    focusTargetSinceGameSecond?: number;
    focusTargetUpdatedGameSecond?: number;
    expansionAttemptGameSecond?: number;
  };
};

export type AiInteractivePlaytestSummary = InteractivePlaytestSummary & {
  aiMemory: Record<PlayerId, AiInteractivePlaytestMemorySummary>;
};

export type AiInteractivePlaytestInspectedUnit = InteractivePlaytestInspectedUnit & {
  memoryClaim: AiInteractivePlaytestMemorySummary["claims"][number] | null;
};

export type AiInteractivePlaytestUnitInspection = Omit<InteractivePlaytestUnitInspection, "units"> & {
  units: AiInteractivePlaytestInspectedUnit[];
};

export function createAiInteractivePlaytestRuntime(session: InteractivePlaytestSession, options: AiInteractivePlaytestRuntimeOptions = {}): AiRuntimeState {
  const enabled = new Set(options.assistControlled ? [session.controlledPlayer, ...session.scriptedPlayers] : session.scriptedPlayers);
  const players = session.game.activePlayers.filter((owner) => enabled.has(owner));
  return createAiRuntime(players, options);
}

export function applyAiInteractivePlaytestCommand(session: InteractivePlaytestSession, runtime: AiRuntimeState, command: InteractivePlaytestCommand) {
  const result = applyInteractivePlaytestCommand(session, command);
  const snapshot = snapshotGame(session.game);
  const byOwner = new Map<PlayerId, typeof result.commands>();
  for (const issued of result.commands) byOwner.set(issued.playerId, [...(byOwner.get(issued.playerId) ?? []), issued]);
  for (const [owner, issued] of byOwner) {
    const memory = runtime.memories[owner] ?? (runtime.memories[owner] = createAiPolicyMemory());
    for (const entry of issued) recordAiMemoryForCommands(snapshot, interactiveMemoryScriptId(command.type, entry.scriptId), [entry.command], memory, { owner, teams: session.game.teams });
  }
  return result;
}

export function stepAiInteractivePlaytestSession(session: InteractivePlaytestSession, runtime: AiRuntimeState, ticks: number) {
  pruneAiInteractivePlaytestMemories(session, runtime);
  stepInteractivePlaytestSession(session, ticks, {
    beforeStep: () => session.frameRuntime.issue(planPresetAiRuntimeCommands(session.game, runtime).commands).commands.length,
  });
  pruneAiInteractivePlaytestMemories(session, runtime);
}

export function stepAiInteractivePlaytestUntil(session: InteractivePlaytestSession, runtime: AiRuntimeState, condition: InteractivePlaytestCondition, options: Pick<InteractivePlaytestUntilOptions, "maxTicks">): InteractivePlaytestUntilResult {
  pruneAiInteractivePlaytestMemories(session, runtime);
  const result = stepInteractivePlaytestUntil(session, condition, {
    maxTicks: options.maxTicks,
    beforeStep: () => session.frameRuntime.issue(planPresetAiRuntimeCommands(session.game, runtime).commands).commands.length,
  });
  pruneAiInteractivePlaytestMemories(session, runtime);
  return result;
}

export function summarizeAiInteractivePlaytestSession(session: InteractivePlaytestSession, runtime: AiRuntimeState): AiInteractivePlaytestSummary {
  pruneAiInteractivePlaytestMemories(session, runtime);
  return {
    ...summarizeInteractivePlaytestSession(session),
    aiMemory: Object.fromEntries(Object.entries(runtime.memories).map(([owner, memory]) => [owner, summarizeAiMemory(memory)])) as Record<PlayerId, AiInteractivePlaytestMemorySummary>,
  };
}

export function inspectAiInteractivePlaytestUnits(session: InteractivePlaytestSession, runtime: AiRuntimeState, options: { owner?: InteractivePlaytestUnitInspectionOwner } = {}): AiInteractivePlaytestUnitInspection {
  pruneAiInteractivePlaytestMemories(session, runtime);
  const inspection = inspectInteractivePlaytestUnits(session, options);
  return {
    ...inspection,
    units: inspection.units.map((unit) => ({
      ...unit,
      memoryClaim: runtime.memories[unit.owner]?.unitClaims[unit.id] ? summarizeUnitClaim(unit.id, runtime.memories[unit.owner]!.unitClaims[unit.id]!) : null,
    })),
  };
}

function pruneAiInteractivePlaytestMemories(session: InteractivePlaytestSession, runtime: AiRuntimeState) {
  const snapshot = snapshotGame(session.game);
  for (const [owner, memory] of Object.entries(runtime.memories)) pruneAiPolicyMemory(snapshot, owner as PlayerId, memory);
}

function interactiveMemoryScriptId(commandType: InteractivePlaytestCommand["type"], issuedScriptId: string) {
  if (commandType === "creepCamp") return "objectiveControl";
  if (commandType === "expand") return "expansion";
  if (commandType === "retreat" || commandType === "retreatWounded") return "skirmishPreservation";
  if (commandType === "hire") return "mercenary";
  if (commandType === "attackMove" || commandType === "focusFire" || commandType === "focusFireNear") return "attackWave";
  return issuedScriptId;
}

function summarizeUnitClaim(unitId: string, claim: AiPolicyUnitClaim): AiInteractivePlaytestMemorySummary["claims"][number] {
  return {
    unitId,
    kind: claim.kind,
    targetId: claim.targetId,
    ...(claim.x === undefined ? {} : { x: claim.x }),
    ...(claim.y === undefined ? {} : { y: claim.y }),
    sinceGameSecond: tickSecond(claim.sinceTick),
    expiresGameSecond: tickSecond(claim.expiresTick),
  };
}

function summarizeAiMemory(memory: AiPolicyMemory): AiInteractivePlaytestMemorySummary {
  return {
    jobs: memory.jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      createdGameSecond: tickSecond(job.createdTick),
      updatedGameSecond: tickSecond(job.updatedTick),
    })),
    claims: Object.entries(memory.unitClaims)
      .map(([unitId, claim]) => summarizeUnitClaim(unitId, claim))
      .sort((a, b) => a.unitId.localeCompare(b.unitId)),
    ...(memory.strategicPlan ? { strategicPlan: summarizeStrategicPlan(memory.strategicPlan) } : {}),
  };
}

function summarizeStrategicPlan(strategicPlan: NonNullable<AiPolicyMemory["strategicPlan"]>): NonNullable<AiInteractivePlaytestMemorySummary["strategicPlan"]> {
  return {
    ...(strategicPlan.focusTargetOwner === undefined ? {} : { focusTargetOwner: strategicPlan.focusTargetOwner }),
    ...(strategicPlan.focusTargetId === undefined ? {} : { focusTargetId: strategicPlan.focusTargetId }),
    ...(strategicPlan.focusTargetSinceTick === undefined ? {} : { focusTargetSinceGameSecond: tickSecond(strategicPlan.focusTargetSinceTick) }),
    ...(strategicPlan.focusTargetUpdatedTick === undefined ? {} : { focusTargetUpdatedGameSecond: tickSecond(strategicPlan.focusTargetUpdatedTick) }),
    ...(strategicPlan.expansionAttemptTick === undefined ? {} : { expansionAttemptGameSecond: tickSecond(strategicPlan.expansionAttemptTick) }),
  };
}

function tickSecond(tick: number) {
  return tick / SIM_TICKS_PER_SECOND;
}
