import { AI_SCRIPT_VERSIONS, SKETCH_RTS_PRESET_AI_STACK, createAiPolicyMemory, planAiCommandEntriesFromScripts, type AiPolicyMemory, type AiScript, type AiScriptVersion, type PresetAiPolicyOptions } from "./policy";
import type { SdkGameAgent, SdkGameCommandPlanner, SdkGameRunInput, SdkGameLoopHooks } from "../sdk/game-runner";
import { runGame, runGameLoop } from "../sdk/game-runner";
import type { PlayerId } from "../shared/types";

const DEFAULT_AI_GAME_POLICY_VERSION: AiScriptVersion = "v2";

export type AiGameAgent = SdkGameAgent & {
  version: AiScriptVersion;
  policyVersion?: AiScriptVersion;
  scripts?: AiScript[];
  policyMode?: PresetAiPolicyOptions["policyMode"];
  disabledBehaviors?: PresetAiPolicyOptions["disabledBehaviors"];
};

export type AiGameRunInput = Omit<SdkGameRunInput<AiGameAgent>, "commandPlanner"> & {
  commandPlanner?: SdkGameCommandPlanner<AiGameAgent>;
};

export function runAiGame(input: AiGameRunInput) {
  return runGame(withAiCommandPlanner(input));
}

export function runAiGameLoop(input: AiGameRunInput, hooks: SdkGameLoopHooks = {}) {
  return runGameLoop(withAiCommandPlanner(input), hooks);
}

export function createAiGameCommandPlanner(options: PresetAiPolicyOptions = {}): SdkGameCommandPlanner<AiGameAgent> {
  const memories: Record<PlayerId, AiPolicyMemory> = {};
  return ({ snapshot, owner, agent, source, teams }) => {
    const version = agent.version ?? DEFAULT_AI_GAME_POLICY_VERSION;
    const policyVersion = agent.policyVersion ?? options.version ?? version;
    const scripts = agent.scripts ?? AI_SCRIPT_VERSIONS[policyVersion] ?? SKETCH_RTS_PRESET_AI_STACK;
    const memory = memories[owner] ?? (memories[owner] = createAiPolicyMemory());
    const disabledBehaviors = agent.disabledBehaviors ?? options.disabledBehaviors;
    const policyMode = agent.policyMode ?? options.policyMode;
    return planAiCommandEntriesFromScripts(snapshot, owner, scripts, { teams, ...options, version: policyVersion, ...(policyMode ? { policyMode } : {}), ...(disabledBehaviors ? { disabledBehaviors } : {}), memory }).map((entry) => ({
      playerId: owner,
      source,
      scriptId: entry.scriptId,
      command: entry.command,
    }));
  };
}

function withAiCommandPlanner(input: AiGameRunInput): SdkGameRunInput<AiGameAgent> {
  return {
    ...input,
    commandPlanner: input.commandPlanner ?? createAiGameCommandPlanner(),
  };
}
