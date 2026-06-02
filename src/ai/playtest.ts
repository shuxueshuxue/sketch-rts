import { applyInteractivePlaytestCommand, stepInteractivePlaytestSession, stepInteractivePlaytestUntil, summarizeInteractivePlaytestSession, type InteractivePlaytestCommand, type InteractivePlaytestCondition, type InteractivePlaytestSession, type InteractivePlaytestSummary, type InteractivePlaytestUntilOptions, type InteractivePlaytestUntilResult } from "../sdk/playtest";
import { createAiRuntime, runPresetAiRuntime, type AiRuntimeState } from "./runtime";
import type { AiScript } from "./policy";
import { recordAiMemoryForCommands } from "./policy/claims";
import type { AiScriptVersion, PlayerId } from "../shared/types";
import { snapshotGame } from "../shared/sim";
import { createAiPolicyMemory, type AiPolicyMemory, type AiPolicyUnitClaim } from "./memory";
import { SIM_TICKS_PER_SECOND } from "../shared/time";

export type AiInteractivePlaytestRuntimeOptions = {
  assistControlled?: boolean;
  thinkInterval?: number;
  scripts?: AiScript[];
  version?: AiScriptVersion;
  versions?: Partial<Record<PlayerId, AiScriptVersion>>;
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
    focusTargetSinceGameSecond?: number;
    focusTargetUpdatedGameSecond?: number;
    expansionAttemptGameSecond?: number;
  };
};

export type AiInteractivePlaytestSummary = InteractivePlaytestSummary & {
  aiMemory: Record<PlayerId, AiInteractivePlaytestMemorySummary>;
};

export function createAiInteractivePlaytestRuntime(session: InteractivePlaytestSession, options: AiInteractivePlaytestRuntimeOptions = {}): AiRuntimeState {
  const players = options.assistControlled ? [session.controlledPlayer, ...session.scriptedPlayers] : session.scriptedPlayers;
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
  stepInteractivePlaytestSession(session, ticks, {
    beforeStep: () => runPresetAiRuntime(session.game, runtime).commands.length,
  });
}

export function stepAiInteractivePlaytestUntil(session: InteractivePlaytestSession, runtime: AiRuntimeState, condition: InteractivePlaytestCondition, options: Pick<InteractivePlaytestUntilOptions, "maxTicks">): InteractivePlaytestUntilResult {
  return stepInteractivePlaytestUntil(session, condition, {
    maxTicks: options.maxTicks,
    beforeStep: () => runPresetAiRuntime(session.game, runtime).commands.length,
  });
}

export function summarizeAiInteractivePlaytestSession(session: InteractivePlaytestSession, runtime: AiRuntimeState): AiInteractivePlaytestSummary {
  return {
    ...summarizeInteractivePlaytestSession(session),
    aiMemory: Object.fromEntries(Object.entries(runtime.memories).map(([owner, memory]) => [owner, summarizeAiMemory(memory)])) as Record<PlayerId, AiInteractivePlaytestMemorySummary>,
  };
}

function interactiveMemoryScriptId(commandType: InteractivePlaytestCommand["type"], issuedScriptId: string) {
  if (commandType === "creepCamp") return "objectiveControl";
  if (commandType === "expand") return "expansion";
  if (commandType === "retreat" || commandType === "retreatWounded") return "skirmishPreservation";
  if (commandType === "hire") return "mercenary";
  if (commandType === "attackMove" || commandType === "focusFire") return "attackWave";
  return issuedScriptId;
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
      .map(([unitId, claim]) => ({
        unitId,
        kind: claim.kind,
        targetId: claim.targetId,
        ...(claim.x === undefined ? {} : { x: claim.x }),
        ...(claim.y === undefined ? {} : { y: claim.y }),
        sinceGameSecond: tickSecond(claim.sinceTick),
        expiresGameSecond: tickSecond(claim.expiresTick),
      }))
      .sort((a, b) => a.unitId.localeCompare(b.unitId)),
    ...(memory.strategicPlan ? { strategicPlan: summarizeStrategicPlan(memory.strategicPlan) } : {}),
  };
}

function summarizeStrategicPlan(strategicPlan: NonNullable<AiPolicyMemory["strategicPlan"]>): NonNullable<AiInteractivePlaytestMemorySummary["strategicPlan"]> {
  return {
    ...(strategicPlan.focusTargetOwner === undefined ? {} : { focusTargetOwner: strategicPlan.focusTargetOwner }),
    ...(strategicPlan.focusTargetSinceTick === undefined ? {} : { focusTargetSinceGameSecond: tickSecond(strategicPlan.focusTargetSinceTick) }),
    ...(strategicPlan.focusTargetUpdatedTick === undefined ? {} : { focusTargetUpdatedGameSecond: tickSecond(strategicPlan.focusTargetUpdatedTick) }),
    ...(strategicPlan.expansionAttemptTick === undefined ? {} : { expansionAttemptGameSecond: tickSecond(strategicPlan.expansionAttemptTick) }),
  };
}

function tickSecond(tick: number) {
  return tick / SIM_TICKS_PER_SECOND;
}
