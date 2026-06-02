import { stepInteractivePlaytestSession, stepInteractivePlaytestUntil, type InteractivePlaytestCondition, type InteractivePlaytestSession, type InteractivePlaytestUntilOptions, type InteractivePlaytestUntilResult } from "../sdk/playtest";
import { createAiRuntime, runPresetAiRuntime, type AiRuntimeState } from "./runtime";
import type { AiScript } from "./policy";
import type { AiScriptVersion, PlayerId } from "../shared/types";

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
