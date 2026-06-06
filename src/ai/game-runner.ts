import { type AiScript, type AiScriptVersion, type PresetAiPolicyOptions } from "./policy";
import { DEFAULT_AI_PLANNER_VERSION, createAiMemoryProvider, planAiOwnerCommandEntries } from "./planner-context";
import type { SdkGameAgent, SdkGameCommandPlanner, SdkGameRunInput, SdkGameLoopHooks } from "../sdk/game-runner";
import { runGame, runGameLoop } from "../sdk/game-runner";

const DEFAULT_AI_GAME_POLICY_VERSION: AiScriptVersion = DEFAULT_AI_PLANNER_VERSION;

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
  const memoryProvider = createAiMemoryProvider();
  return ({ snapshot, owner, agent, source, teams }) => {
    const version = agent.version ?? DEFAULT_AI_GAME_POLICY_VERSION;
    const policyVersion = agent.policyVersion ?? options.version ?? version;
    return planAiOwnerCommandEntries(
      snapshot,
      {
        playerId: owner,
        source,
        version: policyVersion,
        ...(agent.scripts ? { scripts: agent.scripts } : {}),
        ...(agent.policyMode ? { policyMode: agent.policyMode } : {}),
        ...(agent.disabledBehaviors ? { disabledBehaviors: agent.disabledBehaviors } : {}),
      },
      { teams, ...options, memoryProvider },
    );
  };
}

function withAiCommandPlanner(input: AiGameRunInput): SdkGameRunInput<AiGameAgent> {
  return {
    ...input,
    commandPlanner: input.commandPlanner ?? createAiGameCommandPlanner(),
  };
}
