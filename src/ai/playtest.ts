import { stepInteractivePlaytestSession, stepInteractivePlaytestUntil, type InteractivePlaytestCondition, type InteractivePlaytestSession, type InteractivePlaytestUntilOptions, type InteractivePlaytestUntilResult } from "../sdk/playtest";
import { createAiRuntime, runPresetAiRuntime, type AiRuntimeState } from "./runtime";
import type { AiScriptVersion, PlayerId } from "../shared/types";

export type AiInteractivePlaytestRuntimeOptions = {
  thinkInterval?: number;
  version?: AiScriptVersion;
  versions?: Partial<Record<PlayerId, AiScriptVersion>>;
};

export function createAiInteractivePlaytestRuntime(session: InteractivePlaytestSession, options: AiInteractivePlaytestRuntimeOptions = {}): AiRuntimeState {
  return createAiRuntime(session.scriptedPlayers, options);
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
