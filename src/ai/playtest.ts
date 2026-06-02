import { stepInteractivePlaytestSession, type InteractivePlaytestSession } from "../sdk/playtest";
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
