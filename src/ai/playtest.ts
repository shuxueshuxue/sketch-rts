import { applyInteractivePlaytestCommand, stepInteractivePlaytestSession, stepInteractivePlaytestUntil, type InteractivePlaytestCommand, type InteractivePlaytestCondition, type InteractivePlaytestSession, type InteractivePlaytestUntilOptions, type InteractivePlaytestUntilResult } from "../sdk/playtest";
import { createAiRuntime, runPresetAiRuntime, type AiRuntimeState } from "./runtime";
import type { AiScript } from "./policy";
import { recordAiMemoryForCommands } from "./policy/claims";
import type { AiScriptVersion, PlayerId } from "../shared/types";
import { snapshotGame } from "../shared/sim";
import { createAiPolicyMemory } from "./memory";

export type AiInteractivePlaytestRuntimeOptions = {
  assistControlled?: boolean;
  thinkInterval?: number;
  scripts?: AiScript[];
  version?: AiScriptVersion;
  versions?: Partial<Record<PlayerId, AiScriptVersion>>;
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
    for (const entry of issued) recordAiMemoryForCommands(snapshot, interactiveMemoryScriptId(command.type, entry.scriptId), [entry.command], memory);
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

function interactiveMemoryScriptId(commandType: InteractivePlaytestCommand["type"], issuedScriptId: string) {
  if (commandType === "creepCamp") return "objectiveControl";
  if (commandType === "expand") return "expansion";
  if (commandType === "retreat") return "skirmishPreservation";
  if (commandType === "hire") return "mercenary";
  return issuedScriptId;
}
