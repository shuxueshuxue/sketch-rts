import type { AiBehaviorId, AiBehaviorStats, AiTelemetry, PresetAiPolicyOptions } from "./types";

export function createAiTelemetry(): AiTelemetry {
  return {
    behaviors: {
      workerHarassment: emptyBehaviorStats(),
      earlyHarassment: emptyBehaviorStats(),
      skirmishPreservation: emptyBehaviorStats(),
      expansionFallback: emptyBehaviorStats(),
      economicCatchUp: emptyBehaviorStats(),
    },
  };
}

function emptyBehaviorStats(): AiBehaviorStats {
  return { attempts: 0, workerRaidCommands: 0, retreatCommands: 0, disabledSkips: 0, disadvantagedRetreats: 0, woundedMeleeSaves: 0, woundedRangedPullbacks: 0, rangedKites: 0, expansionFallbackRetreats: 0, catchUpExpansions: 0, catchUpTowers: 0 };
}

export function behaviorDisabled(options: PresetAiPolicyOptions, behavior: AiBehaviorId) {
  return options.disabledBehaviors?.includes(behavior) ?? false;
}

export function recordBehavior(options: PresetAiPolicyOptions, behavior: AiBehaviorId, stat: keyof AiBehaviorStats) {
  if (!options.telemetry) return;
  options.telemetry.behaviors[behavior][stat] += 1;
}
